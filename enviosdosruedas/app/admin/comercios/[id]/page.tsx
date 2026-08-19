'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, KeyRound, Pencil } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import AccesoDelComercio from '@/components/admin/AccesoDelComercio';
import EditarComercio, { type Comercio } from '@/components/admin/EditarComercio';
import ResumenDelComercio from '@/components/comercio/ResumenDelComercio';

/**
 * Un comercio, entero: sus envíos, su acceso y su ficha.
 *
 * PARA QUÉ. Cuando el comercio llama, quien atiende necesita tener adelante lo
 * mismo que el comercio está mirando. Antes eso había que armarlo a mano:
 * buscar sus envíos en el listado general filtrando por nombre, y adivinar si
 * podía entrar o no. Acá está todo junto y es la misma pantalla que ve él, no
 * una parecida.
 *
 * LA DIFERENCIA CON EL PORTAL: desde acá cada envío tiene el link para abrirlo
 * en el panel, donde se puede editar, reasignar, reprogramar y borrar. El
 * comercio ve la misma lista sin ese link, porque para él es de lectura.
 *
 * No se duplica el editor de envíos: el panel ya lo tiene y es el bueno. Tener
 * dos formas de editar un envío es tener dos formas de que queden distintos.
 */
export default function ComercioPage() {
  const ready = useAdminGuard();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);

  const [comercio, setComercio] = useState<Comercio | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [editando, setEditando] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ready || !Number.isFinite(id)) return;
    let vivo = true;

    const traer = async () => {
      const { data, error: e } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (!vivo) return;
      if (e) setError(e.message);
      else setComercio((data as Comercio) ?? null);
      setCargando(false);
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [ready, id, version]);

  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  if (!ready) return null;

  return (
    <div className="min-h-full bg-[var(--edr-paper)]">
      <main className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        <Link
          href="/admin/comercios"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--edr-muted)] hover:text-[var(--edr-acento)]"
        >
          <ArrowLeft size={14} /> Todos los comercios
        </Link>

        {cargando ? (
          <p className="text-sm text-[var(--edr-muted)]">Cargando…</p>
        ) : error ? (
          <div className="rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        ) : !comercio ? (
          <p className="rounded-lg border border-dashed border-[var(--edr-border)] px-4 py-10 text-center text-sm text-[var(--edr-muted)]">
            Ese comercio ya no existe. Puede que lo hayan borrado.
          </p>
        ) : (
          <>
            {/* ------------------------------------------------- la ficha */}
            <section className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-black sm:text-2xl">{comercio.name}</h2>
                    {!comercio.active && (
                      <span className="rounded bg-[var(--edr-surface-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-muted)]">
                        inactivo
                      </span>
                    )}
                    {comercio.lat == null && (
                      <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-naranja-claro)]">
                        sin ubicar
                      </span>
                    )}
                    {comercio.profile_id && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-verde-claro)]">
                        <KeyRound size={10} /> entra al portal
                      </span>
                    )}
                  </div>

                  <p className="mt-1 text-sm text-[var(--edr-muted)]">
                    Se retira en {comercio.pickup_address || 'sin dirección cargada'}
                    {comercio.pickup_extra ? ` (${comercio.pickup_extra})` : ''}
                    {comercio.pickup_window ? ` · ${comercio.pickup_window}` : ' · sin horario'}
                    {comercio.pickup_notes ? ` · ${comercio.pickup_notes}` : ''}
                    {comercio.phone ? ` · ${comercio.phone}` : ''}
                  </p>
                </div>

                <button
                  onClick={() => setEditando(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-bold hover:bg-[var(--edr-surface-2)]"
                >
                  <Pencil size={14} /> Editar ficha
                </button>
              </div>
            </section>

            {/* ------------------------------------------------ el acceso */}
            <div className="mb-4">
              <AccesoDelComercio
                clientId={comercio.id}
                nombre={comercio.name}
                tieneAcceso={Boolean(comercio.profile_id)}
                onCambio={recargar}
              />
            </div>

            {/* ---------------------------------------------- sus envíos */}
            <h3 className="mb-2 text-sm font-black uppercase tracking-wide text-[var(--edr-muted)]">
              Lo que ve el comercio
            </h3>
            <div className="-mx-3 sm:-mx-6">
              <ResumenDelComercio comercio={comercio} desdeLaOficina />
            </div>
          </>
        )}
      </main>

      {editando && comercio && (
        <EditarComercio
          comercio={comercio}
          onCerrar={() => setEditando(false)}
          onGuardado={() => {
            setEditando(false);
            recargar();
          }}
          /* Si lo borró, acá ya no hay nada que mirar: vuelve a la lista. */
          onBorrado={() => router.replace('/admin/comercios')}
        />
      )}
    </div>
  );
}
