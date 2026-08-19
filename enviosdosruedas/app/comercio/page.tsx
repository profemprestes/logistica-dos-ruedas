'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, Warehouse } from 'lucide-react';
import Logo from '@/components/Logo';
import { WHATSAPP } from '@/components/SiteFooter';
import ResumenDelComercio, { type FichaComercio } from '@/components/comercio/ResumenDelComercio';
import { supabase } from '@/lib/supabaseClient';

/**
 * El portal del comercio: sus envíos, todos, y nada más que los suyos.
 *
 * PARA QUÉ EXISTE. Hoy el comercio escribe por WhatsApp "¿salió el de
 * Falucho?" y alguien de la oficina deja lo que está haciendo, busca y
 * contesta. Multiplicado por catorce comercios, eso es media mañana. Acá entra
 * con su usuario y lo mira solo, a la hora que quiera, incluso un domingo.
 *
 * QUÉ NO HACE. No carga, no edita, no cancela. Es de lectura, y esa es la
 * decisión más importante: un portal que sólo mira no puede romper una
 * operación en curso. El día que se quiera que suban sus propios envíos, eso
 * es otra conversación con otras preguntas —quién pone el precio, quién
 * valida la dirección, qué pasa si cargan cualquier cosa—.
 *
 * EL FILTRO DE VERDAD NO ESTÁ ACÁ. Está en los permisos de la base (paso 49):
 * aunque alguien manipule esta pantalla desde el navegador, la base no le
 * devuelve un envío que no sea suyo. Esto es la vidriera; la puerta con llave
 * está abajo.
 */

/** Consulta suelta: devuelve a dónde hay que ir, o los datos ya listos. */
type Carga =
  | { destino: '/login' | '/admin' | '/driver' | '/stock' }
  | { comercio: FichaComercio | null; sucursales: FichaComercio[]; tieneStock: boolean };

async function cargar(): Promise<Carga> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { destino: '/login' };

  const uid = data.session.user.id;

  // Cada uno a su pantalla. El admin ve TODOS los comercios desde el panel; el
  // repartidor no tiene nada que hacer acá.
  const { data: perfil } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', uid)
    .maybeSingle();

  if (perfil?.role === 'admin') return { destino: '/admin' };
  if (perfil?.role === 'repartidor') return { destino: '/driver' };

  const CAMPOS = 'id, name, pickup_address, pickup_extra, pickup_window, phone';

  const { data: ficha } = await supabase
    .from('clients')
    .select(CAMPOS)
    .eq('profile_id', uid)
    .maybeSingle();

  /*
   * Los otros locales del mismo dueño, si tiene.
   *
   * Sus envíos van en la misma lista: el que mandó el paquete tiene un negocio,
   * no dos, aunque salga de dos direcciones. Los permisos del paso 50 dejan ver
   * las sucursales de la ficha propia y ninguna otra.
   */
  const { data: locales } = ficha
    ? await supabase.from('clients').select(CAMPOS).eq('parent_id', ficha.id).order('name')
    : { data: [] };

  /*
   * Un comercio puede tener stock guardado y no tener envíos, o al revés: son
   * dos fichas distintas en dos tablas distintas, y el acceso a cada una se da
   * por separado. Si sólo tiene stock, lo suyo es la pantalla de stock y no
   * este cartel de "no encontramos nada".
   */
  const { data: stock } = await supabase.from('stock_clients').select('id').limit(1);
  const tieneStock = (stock ?? []).length > 0;

  if (!ficha && tieneStock) return { destino: '/stock' };

  return {
    comercio: (ficha as FichaComercio) ?? null,
    sucursales: (locales ?? []) as FichaComercio[],
    tieneStock,
  };
}

export default function ComercioPage() {
  const router = useRouter();
  const [comercio, setComercio] = useState<FichaComercio | null>(null);
  const [sucursales, setSucursales] = useState<FichaComercio[]>([]);
  const [tieneStock, setTieneStock] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  const aplicar = useCallback(
    (r: Carga) => {
      if ('destino' in r) {
        router.replace(r.destino);
        return;
      }
      setComercio(r.comercio);
      setSucursales(r.sucursales);
      setTieneStock(r.tieneStock);
      setCargando(false);
    },
    [router],
  );

  useEffect(() => {
    let vivo = true;
    cargar()
      .then((r) => vivo && aplicar(r))
      .catch((e) => {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : 'No se pudo entrar.');
        setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [aplicar]);

  async function salir() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-[var(--edr-border)] bg-[var(--edr-surface)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:px-6 sm:py-4">
          <Logo size={40} />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black tracking-tight text-[var(--edr-yellow)] sm:text-xl">
              {comercio?.name ?? 'Mis envíos'}
            </h1>
            <p className="text-[11px] text-[var(--edr-muted)] sm:text-xs">
              Tus envíos con Envíos DosRuedas
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* El stock es otra pantalla y otra ficha. El link aparece sólo si
                de verdad tiene mercadería nuestra: si no, sería una puerta a
                una habitación vacía. */}
            {tieneStock && (
              <Link
                href="/stock"
                className="inline-flex items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-2 text-xs font-bold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                <Warehouse size={14} /> Mi stock
              </Link>
            )}
            <button
              onClick={salir}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-2 text-xs font-bold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
            >
              <LogOut size={14} /> Salir
            </button>
          </div>
        </div>

        {comercio?.pickup_address && (
          <div className="mx-auto max-w-4xl px-3 pb-3 text-xs text-[var(--edr-muted)] sm:px-6">
            Retiramos en <strong>{comercio.pickup_address}</strong>
            {comercio.pickup_extra ? ` (${comercio.pickup_extra})` : ''}
            {comercio.pickup_window ? ` · ${comercio.pickup_window}` : ''}
            {/* Con más de un local hay que decir los dos: si no, el comercio
                lee la dirección de uno solo y cree que del otro no retiramos. */}
            {sucursales.map((s) => (
              <span key={s.id}>
                {' · '}
                <strong>{s.pickup_address}</strong>
                {s.pickup_window ? ` (${s.pickup_window})` : ''}
              </span>
            ))}
            .{' '}
            <span className="opacity-80">Si algo de esto cambió, avisanos y lo corregimos.</span>
          </div>
        )}
      </header>

      {cargando ? (
        <p className="py-16 text-center text-sm text-[var(--edr-muted)]">Entrando…</p>
      ) : error ? (
        <div className="mx-auto mt-6 max-w-lg rounded border border-red-400 bg-red-950 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : !comercio ? (
        /*
         * Pasa cuando el usuario existe pero nadie lo ató a una ficha. En vez
         * de una pantalla vacía —que se lee como "no tenés envíos" y hace que
         * el comercio llame preguntando por qué desaparecieron— se dice lo que
         * en realidad pasa y a quién avisarle.
         */
        <div className="mx-auto mt-8 max-w-lg rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-6 text-center">
          <p className="font-bold">Tu usuario todavía no está asociado a un comercio.</p>
          <p className="mt-2 text-sm text-[var(--edr-muted)]">
            No es que no tengas envíos: es que falta enlazar esta cuenta con tu ficha. Avisanos y lo
            dejamos andando en un minuto.
          </p>
          <a
            href={`https://wa.me/${WHATSAPP}`}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-block rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)]"
          >
            Escribinos por WhatsApp
          </a>
        </div>
      ) : (
        <ResumenDelComercio comercio={comercio} sucursales={sucursales} />
      )}
    </div>
  );
}
