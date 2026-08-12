'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { leerSesion } from '@/lib/role';

/**
 * Manda a cada uno a su app antes de que el repartidor vea nada.
 *
 * Va ARRIBA del portón de permisos a propósito. La app instalada en el celular
 * arranca siempre en /driver (`start_url` del manifest), así que al admin que
 * la tenía en la pantalla de inicio le abría la hoja de ruta del repartidor —y
 * antes que eso, el cartel de "habilitá cámara y GPS", que no tiene nada que
 * hacer ahí—. Verificando acá, ni siquiera llega a ver el pedido de permisos.
 *
 * Envuelve todo /driver y no sólo la puerta, porque una notificación puede
 * abrir /driver/dashboard directo, salteándose la puerta.
 */

/**
 * Cuánto se espera la respuesta antes de dejar pasar igual.
 *
 * Sin esto, un repartidor sin señal se quedaría trabado en la puerta de su
 * propia app esperando una consulta que no va a contestar. Trabarlo a él es
 * mucho peor que mostrarle una pantalla de más a un admin.
 */
const ESPERA_MAXIMA_MS = 2000;

export default function RoleGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [listo, setListo] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  const aplicar = useCallback(
    (destino: string | null) => {
      if (destino) {
        setSaliendo(true);
        router.replace(destino);
        return;
      }
      setListo(true);
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;

    // Pase libre si la consulta tarda demasiado: el repartidor sigue trabajando.
    const reloj = setTimeout(() => {
      if (!cancelled) setListo(true);
    }, ESPERA_MAXIMA_MS);

    leerSesion()
      .then((s) => {
        if (cancelled) return;
        clearTimeout(reloj);
        if (!s.logueado) return aplicar('/login');
        if (s.rol === 'admin') return aplicar('/admin');
        if (s.rol === 'comercio') return aplicar('/stock');
        // 'repartidor' o rol desconocido (sin señal): entra.
        aplicar(null);
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(reloj);
        aplicar(null);
      });

    return () => {
      cancelled = true;
      clearTimeout(reloj);
    };
  }, [aplicar]);

  if (saliendo || !listo) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--edr-border)] border-t-[var(--edr-yellow)]" />
        <p className="text-lg font-bold">{saliendo ? 'Te llevamos a tu panel…' : 'Entrando…'}</p>
      </div>
    );
  }

  return <>{children}</>;
}
