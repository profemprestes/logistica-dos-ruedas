'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { checkCamera, checkGeolocation } from '@/lib/driver/permissions';

type Phase = 'pidiendo' | 'ok' | 'bloqueado';

/**
 * Marca de que los permisos ya estaban dados en esta sesión del navegador.
 * Sin esto, cada vez que la app se recarga el repartidor ve la pantalla de
 * "pidiendo permisos" un segundo entero, aunque ya los haya dado hace rato.
 */
const YA_OK = 'edr-permisos-ok';

/**
 * Pregunta por los permisos sin activar nada. Devuelve 'ok' sólo si los dos
 * están concedidos; en cualquier otro caso hay que hacer el chequeo completo.
 */
async function revisarBarato(): Promise<'ok' | 'revisar'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'revisar';
  try {
    const [cam, geo] = await Promise.all([
      navigator.permissions.query({ name: 'camera' as PermissionName }),
      navigator.permissions.query({ name: 'geolocation' }),
    ]);
    return cam.state === 'granted' && geo.state === 'granted' ? 'ok' : 'revisar';
  } catch {
    // Safari no soporta consultar 'camera': se cae al chequeo completo.
    return 'revisar';
  }
}

/**
 * Devuelve la lista de problemas (vacía = todo en orden).
 * No toca el estado de React: así se puede llamar desde un efecto sin cascadas.
 */
async function collectProblems(): Promise<string[]> {
  // Se piden de a uno: dos ventanas de permiso juntas se pisan en Android.
  const camera = await checkCamera();
  const geo = await checkGeolocation();

  return [
    camera.granted ? null : `Cámara: ${camera.detail}`,
    geo.granted ? null : `Ubicación: ${geo.detail}`,
  ].filter((x): x is string => x !== null);
}

/**
 * Portón de entrada de la app del repartidor.
 *
 * Mientras cámara y ubicación no estén dadas, `children` NI SIQUIERA SE MONTA:
 * no hay overlay que se pueda cerrar ni nada abajo para tocar.
 */
export default function PermissionGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('pidiendo');
  const [problems, setProblems] = useState<string[]>([]);

  const apply = useCallback((found: string[]) => {
    setProblems(found);
    setPhase(found.length === 0 ? 'ok' : 'bloqueado');
  }, []);

  /** Reintento a mano (botón) o al volver de Ajustes. */
  const recheck = useCallback(() => {
    setPhase('pidiendo');
    collectProblems().then(apply);
  }, [apply]);

  useEffect(() => {
    let cancelled = false;

    // Si ya los había dado, entra derecho y la verificación corre por detrás.
    // (Va en un microtask para no llamar a setState en el cuerpo del efecto.)
    const yaEstaban = sessionStorage.getItem(YA_OK) === '1';
    if (yaEstaban) {
      Promise.resolve().then(() => {
        if (!cancelled) apply([]);
      });
    }

    // Chequeo barato primero: preguntar por el permiso NO prende la cámara.
    // `getUserMedia` sí la enciende un instante, y hacerlo en cada arranque
    // costaba casi un segundo y gastaba batería al pedo.
    revisarBarato()
      .then((veredicto) => {
        if (cancelled) return null;
        if (veredicto === 'ok') {
          sessionStorage.setItem(YA_OK, '1');
          apply([]);
          return null;
        }
        return collectProblems();
      })
      .then((found) => {
        if (cancelled || found === null) return;
        if (found.length === 0) sessionStorage.setItem(YA_OK, '1');
        else sessionStorage.removeItem(YA_OK);
        apply(found);
      });

    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Si fue a Ajustes a habilitarlos, al volver reintentamos solos.
  useEffect(() => {
    if (phase !== 'bloqueado') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase, recheck]);

  if (phase === 'pidiendo') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[var(--edr-blue)] px-6 text-center text-white">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
        <p className="text-lg font-semibold">Pidiendo permisos de cámara y GPS…</p>
        <p className="text-sm text-white/70">Tocá &quot;Permitir&quot; en los dos carteles.</p>
      </div>
    );
  }

  if (phase === 'bloqueado') {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 overflow-y-auto bg-red-600 px-6 py-10 text-center text-white">
        <div className="text-7xl" aria-hidden>
          ⛔
        </div>

        <h1 className="text-3xl font-black leading-tight">Permisos requeridos</h1>
        <p className="max-w-sm text-xl font-bold">
          Debés habilitar cámara y GPS para trabajar.
        </p>

        <ul className="w-full max-w-sm space-y-2 text-left">
          {problems.map((p) => (
            <li key={p} className="rounded-lg bg-black/25 px-4 py-3 text-base font-semibold">
              {p}
            </li>
          ))}
        </ul>

        <button
          onClick={recheck}
          className="w-full max-w-sm rounded-xl bg-[var(--edr-surface)] px-6 py-5 text-xl font-black text-red-700 active:scale-[0.98]"
        >
          Reintentar
        </button>

        <p className="max-w-sm text-sm text-white/85">
          Si no aparece el cartel: candado ⚙️ al lado de la dirección →{' '}
          <strong>Permisos del sitio</strong> → permitir <strong>Cámara</strong> y{' '}
          <strong>Ubicación</strong>. Después volvé acá.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
