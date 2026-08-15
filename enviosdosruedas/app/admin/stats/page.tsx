'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { money, shipmentCash, type Shipment } from '@/lib/format';
import { dayShift, today } from '@/lib/settlement';

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/**
 * Los atajos no son un modo aparte: sólo completan las dos fechas. Así el
 * período es siempre "de tal día a tal otro" y elegir un día suelto es poner
 * la misma fecha en los dos lados, sin una pantalla distinta para eso.
 */
const ATAJOS = [
  { label: 'Hoy', desde: 0, hasta: 0 },
  { label: 'Ayer', desde: -1, hasta: -1 },
  { label: 'Últimos 7 días', desde: -6, hasta: 0 },
  { label: 'Últimos 30 días', desde: -29, hasta: 0 },
] as const;

/** Cómo se lee el período elegido, para el encabezado. */
function titulo(desde: string, hasta: string): string {
  const dm = (f: string) => f.split('-').reverse().slice(0, 2).join('/');
  if (desde === hasta) return desde === today() ? 'Hoy' : dm(desde);
  return `${dm(desde)} al ${dm(hasta)}`;
}

function fetchShipments(desde: string, hasta: string) {
  return supabase
    .from('shipments')
    .select('*, driver:assigned_driver(full_name)')
    .gte('scheduled_date', desde)
    .lte('scheduled_date', hasta);
}

interface Fila {
  nombre: string;
  total: number;
  entregados: number;
  fallidos: number;
  pendientes: number;
  cancelados: number;
  efectivo: number;
  envios: number;
}

const VACIA = (nombre: string): Fila => ({
  nombre,
  total: 0,
  entregados: 0,
  fallidos: 0,
  pendientes: 0,
  cancelados: 0,
  efectivo: 0,
  envios: 0,
});

function acumular(f: Fila, s: Shipment) {
  f.total += 1;
  if (s.status === 'entregado') {
    f.entregados += 1;
    f.efectivo += shipmentCash(s).total;
    f.envios += Number(s.shipping_fee ?? 0);
  } else if (s.status === 'pendiente_entrega') f.fallidos += 1;
  else if (s.status === 'cancelado') f.cancelados += 1;
  else f.pendientes += 1;
}

export default function StatsPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [desde, setDesde] = useState(() => dayShift(today(), -6));
  const [hasta, setHasta] = useState(() => today());
  const [general, setGeneral] = useState<Fila>(VACIA('General'));
  const [porChofer, setPorChofer] = useState<Fila[]>([]);
  const [porEstado, setPorEstado] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const apply = useCallback(({ data, error: dbError }: Awaited<ReturnType<typeof fetchShipments>>) => {
    if (dbError) {
      console.error('[estadísticas] no se pudo consultar', dbError);
      setError(dbError.message);
      setLoading(false);
      return;
    }

    const filas = (data ?? []) as Shipment[];
    const total = VACIA('General');
    const mapa = new Map<string, Fila>();
    const estados: Record<string, number> = {};

    for (const s of filas) {
      acumular(total, s);
      estados[s.status] = (estados[s.status] ?? 0) + 1;

      const nombre = s.driver?.full_name ?? 'Sin asignar';
      const fila = mapa.get(nombre) ?? VACIA(nombre);
      acumular(fila, s);
      mapa.set(nombre, fila);
    }

    setGeneral(total);
    setPorChofer([...mapa.values()].sort((a, b) => b.total - a.total));
    setPorEstado(estados);
    setError('');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // Al revés se dan vuelta: "del 20 al 10" es un error de dedo, no un pedido
    // de que no aparezca nada.
    const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
    fetchShipments(a, b).then((res) => {
      if (!cancelled) apply(res);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, desde, hasta, apply]);

  /** Un atajo sólo completa las dos fechas. */
  const aplicarAtajo = (a: (typeof ATAJOS)[number]) => {
    setLoading(true);
    setDesde(dayShift(today(), a.desde));
    setHasta(dayShift(today(), a.hasta));
  };

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  const cerrados = general.entregados + general.fallidos;
  const efectividad = cerrados > 0 ? Math.round((general.entregados / cerrados) * 100) : 0;

  return (
    <div className="min-h-full">

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelCls}>Desde</label>
              <input
                type="date"
                value={desde}
                max={hasta}
                onChange={(e) => {
                  setLoading(true);
                  setDesde(e.target.value);
                }}
                className={campo}
              />
            </div>
            <div>
              <label className={labelCls}>Hasta</label>
              <input
                type="date"
                value={hasta}
                min={desde}
                onChange={(e) => {
                  setLoading(true);
                  setHasta(e.target.value);
                }}
                className={campo}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ATAJOS.map((a) => {
                const activo =
                  desde === dayShift(today(), a.desde) && hasta === dayShift(today(), a.hasta);
                return (
                  <button
                    key={a.label}
                    onClick={() => aplicarAtajo(a)}
                    className={`rounded px-3 py-2 text-sm font-black ${
                      activo
                        ? 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                        : 'border border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
                    }`}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>

            <span className="ml-auto text-xs text-[var(--edr-muted)]">
              Por fecha de reparto
            </span>
          </div>

          <h2 className="mt-3 text-lg font-black">
            {titulo(desde, hasta)}
            {desde !== hasta && (
              <span className="ml-2 text-sm font-semibold text-[var(--edr-muted)]">
                {Math.round(
                  (Date.parse(`${hasta}T00:00:00`) - Date.parse(`${desde}T00:00:00`)) / 86_400_000,
                ) + 1}{' '}
                días
              </span>
            )}
          </h2>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <p className="py-16 text-center text-[var(--edr-muted)]">Calculando…</p>
        ) : (
          <>
            {/* ---------- Tarjetas generales ---------- */}
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Tarjeta label="Envíos" valor={String(general.total)} />
              <Tarjeta label="Entregados" valor={String(general.entregados)} tono="ok" />
              <Tarjeta label="No entregados" valor={String(general.fallidos)} tono="warn" />
              <Tarjeta label="Pendientes" valor={String(general.pendientes)} />
              <Tarjeta label="Efectividad" valor={`${efectividad}%`} tono="ok" />
              <Tarjeta label="Cancelados" valor={String(general.cancelados)} />
              <Tarjeta label="Efectivo cobrado" valor={money(general.efectivo)} destacada />
              <Tarjeta label="Envíos facturados" valor={money(general.envios)} />
            </div>

            {/* ---------- Barra de estados ---------- */}
            <section className="mb-6 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-5">
              <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-[var(--edr-muted)]">
                En qué estado están
              </h2>
              <div className="space-y-2">
                {Object.entries(porEstado)
                  .sort((a, b) => b[1] - a[1])
                  .map(([estado, cantidad]) => (
                    <div key={estado} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 text-sm font-semibold capitalize">
                        {estado.replace(/_/g, ' ')}
                      </span>
                      <div className="h-4 flex-1 overflow-hidden rounded bg-[var(--edr-surface-2)]">
                        <div
                          className="h-full bg-[var(--edr-yellow)]"
                          style={{
                            width: `${general.total ? (cantidad / general.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className="edr-mono w-12 shrink-0 text-right text-sm font-black">
                        {cantidad}
                      </span>
                    </div>
                  ))}
              </div>
            </section>

            {/* ---------- Por repartidor ---------- */}
            <section className="overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)]">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--edr-border)] bg-[var(--edr-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--edr-muted)]">
                  <tr>
                    <th className="px-3 py-2">Repartidor</th>
                    <th className="px-3 py-2 text-right">Envíos</th>
                    <th className="px-3 py-2 text-right">Entregados</th>
                    <th className="px-3 py-2 text-right">No entregados</th>
                    <th className="px-3 py-2 text-right">Pendientes</th>
                    <th className="px-3 py-2 text-right">Efectividad</th>
                    <th className="px-3 py-2 text-right">Efectivo cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {porChofer.map((f) => {
                    const cerr = f.entregados + f.fallidos;
                    const efec = cerr > 0 ? Math.round((f.entregados / cerr) * 100) : 0;
                    return (
                      <tr key={f.nombre} className="border-b border-[var(--edr-border)] last:border-0">
                        <td className="px-3 py-2 font-semibold">{f.nombre}</td>
                        <td className="edr-mono px-3 py-2 text-right">{f.total}</td>
                        <td className="edr-mono px-3 py-2 text-right text-[var(--edr-verde-claro)]">
                          {f.entregados}
                        </td>
                        <td className="edr-mono px-3 py-2 text-right text-[var(--edr-naranja-claro)]">{f.fallidos}</td>
                        <td className="edr-mono px-3 py-2 text-right">{f.pendientes}</td>
                        <td className="edr-mono px-3 py-2 text-right font-black">{efec}%</td>
                        <td className="edr-mono px-3 py-2 text-right font-black">
                          {money(f.efectivo)}
                        </td>
                      </tr>
                    );
                  })}

                  {porChofer.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                        No hay envíos en este período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Tarjeta({
  label,
  valor,
  tono,
  destacada,
}: {
  label: string;
  valor: string;
  tono?: 'ok' | 'warn';
  destacada?: boolean;
}) {
  const cls = destacada
    ? 'border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] text-[var(--edr-blue)]'
    : 'border border-[var(--edr-border)] bg-[var(--edr-surface)]';
  const valorCls =
    tono === 'ok' ? 'text-[var(--edr-verde-claro)]' : tono === 'warn' ? 'text-[var(--edr-naranja-claro)]' : '';

  return (
    <div className={`rounded-lg p-4 ${cls}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{label}</div>
      <div className={`edr-mono text-3xl font-black ${destacada ? '' : valorCls}`}>{valor}</div>
    </div>
  );
}
