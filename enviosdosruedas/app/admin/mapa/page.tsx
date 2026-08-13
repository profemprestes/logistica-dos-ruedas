'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import AdminNav from '@/components/AdminNav';
import { dayShift, today } from '@/lib/settlement';
import {
  STATUS_COLOR,
  STATUS_LABEL,
  money,
  shipmentCash,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/format';
import type { PuntoMapa } from '@/components/MapaEnvios';

/** Leaflet toca `window` al cargar: nunca en el servidor. */
const MapaEnvios = dynamic(() => import('@/components/MapaEnvios'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] items-center justify-center rounded-lg border border-dashed border-[var(--edr-border)] text-sm text-[var(--edr-muted)]">
      Abriendo el mapa…
    </div>
  ),
});

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

interface Driver {
  id: string;
  full_name: string;
}

/**
 * El día entero sobre el mapa.
 *
 * Sirve para algo que la tabla no muestra: si el reparto está apelotonado en
 * una zona o desparramado por toda la ciudad, y qué le queda pendiente a cada
 * repartidor y dónde.
 */
export default function MapaAdminPage() {
  const ready = useAdminGuard();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [desde, setDesde] = useState(today);
  const [hasta, setHasta] = useState(today);
  const [soloPendientes, setSoloPendientes] = useState(false);

  const [envios, setEnvios] = useState<Shipment[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [elegido, setElegido] = useState<Shipment | null>(null);

  useEffect(() => {
    if (!ready) return;
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'repartidor')
      .order('full_name')
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    // Los puntos de antes se quedan en pantalla hasta que llegan los nuevos:
    // vaciarlos primero hace parpadear el mapa en cada cambio de filtro.
    let q = supabase
      .from('shipments')
      .select('*, driver:assigned_driver(full_name)')
      .gte('scheduled_date', desde <= hasta ? desde : hasta)
      .lte('scheduled_date', desde <= hasta ? hasta : desde);

    if (driverId) q = q.eq('assigned_driver', driverId);

    q.then(({ data, error: dbError }) => {
      if (!vivo) return;
      if (dbError) setError(dbError.message);
      else {
        setEnvios((data ?? []) as Shipment[]);
        setError('');
      }
      setCargando(false);
    });

    return () => {
      vivo = false;
    };
  }, [ready, desde, hasta, driverId]);

  const CERRADOS: ShipmentStatus[] = useMemo(() => ['entregado', 'cancelado'], []);

  const visibles = useMemo(
    () => (soloPendientes ? envios.filter((s) => !CERRADOS.includes(s.status)) : envios),
    [envios, soloPendientes, CERRADOS],
  );

  const conPunto = useMemo(
    () => visibles.filter((s) => s.lat != null && s.lng != null),
    [visibles],
  );

  const sinPunto = visibles.length - conPunto.length;

  const puntos: PuntoMapa[] = useMemo(
    () =>
      conPunto.map((s, i) => ({
        id: s.id,
        lat: Number(s.lat),
        lng: Number(s.lng),
        etiqueta: String(i + 1),
        color: STATUS_COLOR[s.status],
        titulo: `${i + 1}. ${s.address_street}`,
        detalle:
          `${s.recipient_name} · ${STATUS_LABEL[s.status]}` +
          (s.client_name_raw ? ` · ${s.client_name_raw}` : ''),
      })),
    [conPunto],
  );

  const porEstado = useMemo(() => {
    const cuenta = new Map<ShipmentStatus, number>();
    for (const s of visibles) cuenta.set(s.status, (cuenta.get(s.status) ?? 0) + 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibles]);

  if (!ready) return null;

  const hoy = today();

  return (
    <div className="min-h-screen bg-[var(--edr-paper)]">
      <AdminNav />

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <h2 className="mb-3 text-xl font-black sm:text-2xl">Mapa de envíos</h2>

        <section className="mb-3 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelCls}>Repartidor</label>
              <select
                className={campo}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">Todos</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Desde</label>
              <input
                type="date"
                className={campo}
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Hasta</label>
              <input
                type="date"
                className={campo}
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <Atajo
                label="Hoy"
                onClick={() => {
                  setDesde(hoy);
                  setHasta(hoy);
                }}
              />
              <Atajo
                label="Ayer"
                onClick={() => {
                  setDesde(dayShift(hoy, -1));
                  setHasta(dayShift(hoy, -1));
                }}
              />
              <Atajo
                label="Últimos 7 días"
                onClick={() => {
                  setDesde(dayShift(hoy, -6));
                  setHasta(hoy);
                }}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={soloPendientes}
                onChange={(e) => setSoloPendientes(e.target.checked)}
              />
              Sólo lo que falta hacer
            </label>
          </div>

          {/* La leyenda sale de lo que hay en pantalla y no de la lista fija de
              estados: una referencia con cinco colores que no están en el mapa
              es ruido. */}
          {porEstado.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {porEstado.map(([estado, n]) => (
                <span key={estado} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-block h-3 w-3 rounded-full ring-1 ring-white/40"
                    style={{ background: STATUS_COLOR[estado] }}
                  />
                  {STATUS_LABEL[estado]}: <strong>{n}</strong>
                </span>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        <p className="mb-2 text-sm text-[var(--edr-muted)]">
          {cargando
            ? 'Cargando…'
            : `${conPunto.length} en el mapa${
                sinPunto > 0 ? ` · ${sinPunto} sin ubicar (no se pueden marcar)` : ''
              }`}
        </p>

        {!cargando && conPunto.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[var(--edr-border)] px-6 text-center text-sm text-[var(--edr-muted)]">
            {visibles.length === 0
              ? 'No hay envíos en ese período.'
              : 'Ninguno de los envíos de ese período tiene punto en el mapa. Se les puede poner a mano al editarlos.'}
          </div>
        ) : (
          <MapaEnvios
            puntos={puntos}
            onTocar={(id) => setElegido(envios.find((s) => s.id === id) ?? null)}
          />
        )}

        {elegido && <Ficha envio={elegido} onCerrar={() => setElegido(null)} />}
      </main>
    </div>
  );
}

function Atajo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-[var(--edr-border)] px-2 py-2 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
    >
      {label}
    </button>
  );
}

/** El detalle del envío que se tocó, abajo del mapa. */
function Ficha({ envio, onCerrar }: { envio: Shipment; onCerrar: () => void }) {
  const cash = shipmentCash(envio);
  return (
    <div className="mt-3 rounded-lg border border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="edr-mono text-xs text-[var(--edr-muted)]">{envio.tracking_code}</div>
          <div className="text-lg font-bold">{envio.address_street}</div>
          <div className="text-sm">
            {envio.recipient_name}
            {envio.client_name_raw ? ` · ${envio.client_name_raw}` : ''}
          </div>
          <div className="mt-1 text-sm text-[var(--edr-muted)]">
            {STATUS_LABEL[envio.status]}
            {cash.total > 0 && ` · a cobrar ${money(cash.total)}`}
          </div>
        </div>
        <button
          onClick={onCerrar}
          className="shrink-0 rounded px-2 text-2xl leading-none text-[var(--edr-muted)]"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}
