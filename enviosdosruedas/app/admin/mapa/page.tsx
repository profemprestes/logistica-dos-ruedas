'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { dayShift, today } from '@/lib/settlement';
import {
  marcaDeEstado,
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
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

interface Driver {
  id: string;
  full_name: string;
}

/** Dónde se lo vio por última vez, y por qué. */
interface Repartidor {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  haceMinutos: number;
  /** La hora de esa última señal, que es lo que se lee de un vistazo. */
  hora: string;
  /** De dónde salió el punto: le cambia el sentido a lo que se está mirando. */
  origen: 'app' | 'entrega';
}

/**
 * Desde cuándo la señal deja de ser "de recién".
 *
 * No es un filtro: se muestra igual. Sólo cambia lo que dice al lado.
 *
 * Poner un tope fue un error que costó dos vueltas. Primero diez minutos,
 * después cuarenta y cinco, y en las dos el mapa aparecía vacío teniendo una
 * posición perfectamente útil guardada. El motivo no es la regla sino cómo
 * funciona un navegador: la app manda la posición mientras está EN PANTALLA, y
 * el celular congela los temporizadores de una pestaña que quedó atrás.
 *
 * El tope de verdad ya existe y está en la base: las posiciones se borran
 * solas a las tres horas. O sea que lo que hay guardado es siempre del día. Lo
 * correcto es mostrarlo y decir de cuándo es, que es lo que permite decidir si
 * ese punto todavía sirve.
 */
const MINUTOS_RECIENTE = 20;

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
  const [enCalle, setEnCalle] = useState<Repartidor[]>([]);
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

  /**
   * Dónde anda cada repartidor conectado.
   *
   * Sale de las posiciones que manda la app, las mismas del seguimiento
   * público. Con una diferencia importante: acá va la posición EXACTA, no la
   * zona de 500 metros. Afuera se aproxima porque el link lo abre cualquiera;
   * adentro, coordinar el reparto necesita saber dónde está la moto.
   *
   * Se refresca solo: un mapa de flota que hay que recargar a mano no sirve
   * para mirar mientras se trabaja.
   */
  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    /*
     * DOS FUENTES, y la segunda es la que hace que esto sirva.
     *
     * Una son las posiciones que manda la app sola. La otra son las entregas
     * cerradas: cada vez que el repartidor cierra un envío, la app toma el GPS
     * y lo guarda con el movimiento. Esa segunda fuente venía existiendo desde
     * el principio y el mapa no la miraba, así que un repartidor que entregó
     * hace diez minutos aparecía como sin señal desde hacía una hora.
     *
     * Encima es MEJOR: el punto de una entrega se toma con el celular en la
     * mano y viene con dos metros de precisión, contra los quince o treinta
     * del envío automático. Y no depende de que la app esté en pantalla en el
     * momento justo: si cerró una entrega, hay punto.
     *
     * Gana la más nueva de las dos.
     */
    const traer = async () => {
      const desdeHoy = `${today()}T00:00:00`;

      const [posiciones, entregas] = await Promise.all([
        // La tabla se limpia sola a las tres horas: lo que hay es del día.
        supabase
          .from('driver_positions')
          .select('driver_id, lat, lng, taken_at, perfil:driver_id(full_name)')
          .order('taken_at', { ascending: false })
          .limit(200),
        supabase
          .from('delivery_logs')
          .select('driver_id, lat, lng, happened_at, perfil:driver_id(full_name)')
          .not('lat', 'is', null)
          .gte('happened_at', new Date(desdeHoy).toISOString())
          .order('happened_at', { ascending: false })
          .limit(200),
      ]);

      if (!vivo) return;

      const candidatos: (Repartidor & { cuando: number })[] = [];

      const sumar = (
        driverId: string,
        nombre: string,
        lat: number,
        lng: number,
        cuando: string,
        origen: 'app' | 'entrega',
      ) => {
        const t = new Date(cuando).getTime();
        candidatos.push({
          id: driverId,
          nombre,
          lat: Number(lat),
          lng: Number(lng),
          cuando: t,
          haceMinutos: Math.max(0, Math.round((Date.now() - t) / 60_000)),
          hora: new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          origen,
        });
      };

      type Fila = {
        driver_id: string;
        lat: number;
        lng: number;
        perfil: { full_name: string } | null;
      };

      for (const p of (posiciones.data ?? []) as unknown as (Fila & { taken_at: string })[]) {
        sumar(p.driver_id, p.perfil?.full_name ?? 'Repartidor', p.lat, p.lng, p.taken_at, 'app');
      }

      for (const l of (entregas.data ?? []) as unknown as (Fila & { happened_at: string })[]) {
        if (!l.driver_id) continue;
        sumar(
          l.driver_id,
          l.perfil?.full_name ?? 'Repartidor',
          l.lat,
          l.lng,
          l.happened_at,
          'entrega',
        );
      }

      // Una por repartidor: la más nueva, venga de donde venga.
      const ultima = new Map<string, Repartidor & { cuando: number }>();
      for (const c of candidatos) {
        const previa = ultima.get(c.id);
        if (!previa || c.cuando > previa.cuando) ultima.set(c.id, c);
      }

      setEnCalle([...ultima.values()]);
    };

    void traer();
    const timer = window.setInterval(() => void traer(), 60_000);

    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [ready]);

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

  /**
   * Los repartidores que van al mapa.
   *
   * Sólo cuando el período incluye hoy: mirando el reparto de la semana pasada,
   * una moto en su posición de ahora no significa nada. Y si hay un repartidor
   * elegido en el filtro, se muestra sólo él.
   */
  const motos = useMemo(() => {
    const hoyEnRango = desde <= today() && today() <= hasta;
    if (!hoyEnRango) return [];
    return driverId ? enCalle.filter((r) => r.id === driverId) : enCalle;
  }, [enCalle, driverId, desde, hasta]);

  const puntos: PuntoMapa[] = useMemo(() => {
    const envios: PuntoMapa[] = conPunto.map((s) => {
      const marca = marcaDeEstado(s.status);
      return {
        id: s.id,
        lat: Number(s.lat),
        lng: Number(s.lng),
        etiqueta: marca.simbolo,
        color: marca.color,
        colorTexto: marca.colorTexto,
        titulo: s.address_street,
        detalle:
          `${s.recipient_name} · ${STATUS_LABEL[s.status]}` +
          (s.client_name_raw ? ` · ${s.client_name_raw}` : ''),
      };
    });

    // Las motos van con id negativo para no chocar con el de ningún envío:
    // tocar una no tiene que abrir la ficha de un envío cualquiera.
    const repartidores: PuntoMapa[] = motos.map((r, i) => ({
      id: -(i + 1),
      lat: r.lat,
      lng: r.lng,
      etiqueta: r.nombre.trim().charAt(0).toUpperCase() || '·',
      color: '#7c3aed',
      titulo: r.nombre,
      detalle:
        `${r.origen === 'entrega' ? 'Cerró una entrega' : 'Última señal'} ${r.hora}` +
        (r.haceMinutos > 1 ? ` · hace ${r.haceMinutos} min` : '') +
        (r.haceMinutos > MINUTOS_RECIENTE ? ' · puede haberse movido' : ''),
    }));

    return [...envios, ...repartidores];
  }, [conPunto, motos]);

  /**
   * La referencia va por grupo y no por estado: son los tres colores que
   * aparecen en el mapa, ni uno más. Una referencia con siete estados de los
   * que se dibujan tres es ruido.
   */
  const porGrupo = useMemo(() => {
    const cuenta = new Map<string, { color: string; simbolo: string; n: number }>();
    for (const s of conPunto) {
      const m = marcaDeEstado(s.status);
      const previo = cuenta.get(m.grupo);
      cuenta.set(m.grupo, {
        color: m.color,
        simbolo: m.simbolo,
        n: (previo?.n ?? 0) + 1,
      });
    }
    return [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [conPunto]);

  if (!ready) return null;

  const hoy = today();

  return (
    <div className="min-h-full bg-[var(--edr-paper)]">

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
          {/* Una pantalla que no explica su propio vacío se lee como rota: sin
              este cartel, mirar el mapa y no ver ninguna moto no dice si nadie
              está en la calle o si algo dejó de andar. */}
          {motos.length === 0 && desde <= today() && today() <= hasta && (
            <p className="mt-3 border-t border-[var(--edr-border)] pt-3 text-xs text-[var(--edr-muted)]">
              Todavía no hay ninguna posición de hoy. Aparecen acá mientras tengan envíos del
              día sin cerrar y hayan abierto la app: el celular la manda con la app en pantalla,
              así que la señal llega cuando la usan.
            </p>
          )}

          {motos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--edr-border)] pt-3">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)]">
                En la calle ahora
              </span>
              {motos.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white ring-1 ring-white/40"
                    style={{ background: '#7c3aed' }}
                  >
                    {r.nombre.trim().charAt(0).toUpperCase()}
                  </span>
                  <strong>{r.nombre}</strong>
                  <span
                    className={
                      r.haceMinutos > MINUTOS_RECIENTE
                        ? 'text-[var(--edr-muted)]'
                        : 'font-bold text-[var(--edr-verde-claro)]'
                    }
                  >
                    {r.hora}
                    {r.haceMinutos > 1 ? ` · hace ${r.haceMinutos} min` : ''}
                    {r.origen === 'entrega' ? ' · en una entrega' : ''}
                  </span>
                </span>
              ))}
            </div>
          )}

          {porGrupo.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {porGrupo.map(([grupo, g]) => (
                <span key={grupo} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black ring-1 ring-white/40"
                    style={{ background: g.color, color: grupo === 'Pendiente de entrega' ? '#111827' : '#fff' }}
                  >
                    {g.simbolo}
                  </span>
                  {grupo}: <strong>{g.n}</strong>
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
            // Los id negativos son repartidores: no tienen ficha de envío.
            onTocar={(id) =>
              setElegido(id < 0 ? null : (envios.find((s) => s.id === id) ?? null))
            }
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
