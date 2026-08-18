'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { money } from '@/lib/format';
import {
  customRange,
  dayShift,
  LOG_SELECT,
  summarizeLogs,
  today,
  type DeliveryLog,
} from '@/lib/settlement';

/**
 * La caja de todos, en un solo lugar.
 *
 * QUÉ PREGUNTA CONTESTA, y es una que las otras pantallas no contestaban. El
 * cierre de caja es de un repartidor y de un día; los resúmenes son de un
 * comercio. Faltaba la vista de arriba: cuánta plata hay dando vueltas en la
 * calle, quién la tiene, y cuánto dejó el período.
 *
 * DE DÓNDE SALEN LOS NÚMEROS. De `delivery_logs` pasado por `summarizeLogs`,
 * la misma función que usa el cierre de caja y el celular del repartidor. No
 * hay una cuenta nueva acá: si hubiera, tarde o temprano diría algo distinto
 * de la pantalla donde se paga, y ese es el día en que se deja de creerle a
 * los números.
 *
 * LO RENDIDO SALE DE LOS CIERRES, que es el único lugar donde consta que la
 * plata cambió de manos. Un día sin cerrar cuenta como no rendido, que es la
 * verdad: mientras nadie lo cerró, la plata la sigue teniendo el repartidor.
 */

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

const ATAJOS = [
  { label: 'Hoy', desde: 0, hasta: 0 },
  { label: 'Ayer', desde: -1, hasta: -1 },
  { label: 'Últimos 7 días', desde: -6, hasta: 0 },
  { label: 'Este mes', desde: 'mes' as const, hasta: 0 },
  /*
   * EL ACUMULADO ES EL QUE CONTESTA "cuánto me tiene que rendir".
   *
   * En una ventana de días el saldo miente sin querer: un repartidor puede
   * rendir el martes plata que cobró la semana pasada, y en la ventana de esta
   * semana eso aparece como si le debiéramos. Desde el principio no hay
   * períodos que mezclar y el número es la posición real.
   */
  { label: 'Acumulado', desde: 'todo' as const, hasta: 0 },
] as const;

interface Fila {
  id: string;
  nombre: string;
  entregas: number;
  cobrado: number;
  ganancia: number;
  rendido: number;
  /** Positivo: tiene plata nuestra. Negativo: le debemos. */
  saldo: number;
  diasSinCerrar: number;
}

export default function CajaAdminPage() {
  const ready = useAdminGuard();

  const [desde, setDesde] = useState(() => dayShift(today(), -6));
  const [hasta, setHasta] = useState(() => today());
  const [filas, setFilas] = useState<Fila[]>([]);
  const [totales, setTotales] = useState({
    cobrado: 0,
    ganancia: 0,
    rendido: 0,
    facturado: 0,
    comision: 0,
    shippy: 0,
    envios: 0,
    entregas: 0,
    sinValor: 0,
  });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  /*
   * La carga vive adentro del efecto y no en un `useCallback` de afuera.
   *
   * El compilador de React marca como error llamar a algo que cambia estado
   * desde un efecto, y tiene razón: así el efecto tiene un solo motivo para
   * volver a correr —cambió el período— en vez de depender de la identidad de
   * una función.
   */
  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    const traer = async () => {
      setCargando(true);
      setError('');

      const { from, to } = customRange(desde, hasta);
      const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];

      const [drivers, logs, cierres] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name')
          .eq('role', 'repartidor')
          .order('full_name'),
        supabase
          .from('delivery_logs')
          .select(`${LOG_SELECT}, driver_id`)
          .gte('happened_at', from)
          .lte('happened_at', to),
        supabase
          .from('settlements')
          .select('driver_id, day, actual_amount')
          .gte('day', a)
          .lte('day', b),
      ]);

      if (!vivo) return;

      if (logs.error || drivers.error) {
        setError(logs.error?.message ?? drivers.error?.message ?? 'No se pudo traer la caja.');
        setCargando(false);
        return;
      }

      type ConDriver = DeliveryLog & { driver_id: string };
      const todos = (logs.data ?? []) as unknown as ConDriver[];

      // Cuántos días del período tuvo movimiento cada uno, para poder decir
      // cuántos quedaron sin cerrar: un saldo viejo sin cerrar es lo que hay que
      // ir a buscar, y sin este número no se distingue de uno de hoy.
      const diasConMovimiento = new Map<string, Set<string>>();
      for (const l of todos) {
        const dia = l.happened_at.slice(0, 10);
        const s = diasConMovimiento.get(l.driver_id) ?? new Set<string>();
        s.add(dia);
        diasConMovimiento.set(l.driver_id, s);
      }

      const cerrados = new Map<string, Set<string>>();
      const rendidoPor = new Map<string, number>();
      for (const c of cierres.data ?? []) {
        const s = cerrados.get(c.driver_id) ?? new Set<string>();
        s.add(c.day);
        cerrados.set(c.driver_id, s);
        rendidoPor.set(
          c.driver_id,
          (rendidoPor.get(c.driver_id) ?? 0) + Number(c.actual_amount ?? 0),
        );
      }

      const armadas: Fila[] = [];
      const suma = {
        cobrado: 0,
        ganancia: 0,
        rendido: 0,
        facturado: 0,
        comision: 0,
        shippy: 0,
        envios: 0,
        entregas: 0,
        sinValor: 0,
      };

      for (const d of drivers.data ?? []) {
        const suyos = todos.filter((l) => l.driver_id === d.id);
        if (suyos.length === 0) continue;

        const r = summarizeLogs(suyos);
        const rendido = rendidoPor.get(d.id) ?? 0;

        const conMov = diasConMovimiento.get(d.id) ?? new Set<string>();
        const cerradosSuyos = cerrados.get(d.id) ?? new Set<string>();
        const sinCerrar = [...conMov].filter((x) => !cerradosSuyos.has(x)).length;

        armadas.push({
          id: d.id,
          nombre: d.full_name,
          entregas: r.delivered.length,
          cobrado: r.cashTotal,
          ganancia: r.driverEarnings,
          rendido,
          saldo: r.cashTotal - rendido - r.driverEarnings,
          diasSinCerrar: sinCerrar,
        });

        suma.cobrado += r.cashTotal;
        suma.ganancia += r.driverEarnings;
        suma.rendido += rendido;
        suma.facturado += r.shippingTotal;
        suma.comision += r.profitComision;
        suma.shippy += r.profitShippy;
        suma.envios += r.countShippy;
        suma.entregas += r.delivered.length;
        suma.sinValor += r.shippingMissing;
      }

      if (!vivo) return;
      setFilas(armadas);
      setTotales(suma);
      setCargando(false);
    };

    void traer();

    return () => {
      vivo = false;
    };
  }, [ready, desde, hasta]);

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  const ganancia = totales.comision + totales.shippy;
  const enLaCalle = filas.reduce((acc, f) => acc + Math.max(0, f.saldo), 0);
  const aPagar = filas.reduce((acc, f) => acc + Math.max(0, -f.saldo), 0);

  return (
    <main className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      <h2 className="mb-3 text-xl font-black sm:text-2xl">Caja y ganancia</h2>

      <section className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
        <div className="flex flex-wrap items-end gap-3">
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
            {ATAJOS.map((x) => (
              <button
                key={x.label}
                onClick={() => {
                  setDesde(
                    x.desde === 'mes'
                      ? `${today().slice(0, 7)}-01`
                      : x.desde === 'todo'
                        ? '2020-01-01'
                        : dayShift(today(), x.desde),
                  );
                  setHasta(dayShift(today(), x.hasta));
                }}
                className="rounded-full border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold hover:border-[var(--edr-acento)]"
              >
                {x.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error && (
        <p className="mb-4 rounded border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {cargando ? (
        <p className="py-10 text-center text-sm text-[var(--edr-muted)]">Sacando la cuenta…</p>
      ) : (
        <>
          {/* ---------- Tu ganancia ---------- */}
          <section className="mb-4 rounded-lg border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-4">
            <div className="text-[11px] font-black uppercase tracking-wide text-[var(--edr-muted)]">
              Tu ganancia del período
            </div>
            <div className="edr-mono text-4xl font-black text-[var(--edr-acento)]">
              {money(ganancia)}
            </div>

            {/* Separadas porque se mueven por razones distintas: la comisión
                sube si suben las tarifas, lo de Shippy sólo si se hacen más
                envíos de ellos. */}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                Comisión de {money(totales.facturado)} facturados:{' '}
                <strong className="edr-mono">{money(totales.comision)}</strong>
              </span>
              <span>
                Shippy ({totales.envios} envío{totales.envios === 1 ? '' : 's'}
                ): <strong className="edr-mono">{money(totales.shippy)}</strong>
              </span>
            </div>

            {totales.sinValor > 0 && (
              <p className="mt-2 rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                {totales.sinValor} entrega(s) sin valor de envío cargado: no suman ni a la
                facturación ni a la ganancia hasta que les pongas el precio.
              </p>
            )}
          </section>

          {/* ---------- Dónde está la plata ---------- */}
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Tarjeta label="Cobrado en la calle" valor={money(totales.cobrado)} />
            <Tarjeta label="Ya rendido" valor={money(totales.rendido)} />
            <Tarjeta label="Tienen que rendir" valor={money(enLaCalle)} tono="warn" />
            <Tarjeta label="Hay que pagarles" valor={money(aPagar)} tono="ok" />
          </div>

          {/* ---------- Uno por uno ---------- */}
          <section className="overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--edr-surface-2)] text-left text-xs uppercase text-[var(--edr-muted)]">
                <tr>
                  <th className="px-3 py-2">Repartidor</th>
                  <th className="px-3 py-2 text-right">Entregas</th>
                  <th className="px-3 py-2 text-right">Cobró</th>
                  <th className="px-3 py-2 text-right">Su ganancia</th>
                  <th className="px-3 py-2 text-right">Rindió</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-[var(--edr-muted)]">
                      Nadie movió nada en ese período.
                    </td>
                  </tr>
                )}

                {filas.map((f) => (
                  <tr key={f.id} className="border-t border-[var(--edr-border)]">
                    <td className="px-3 py-2 font-semibold">
                      <Link
                        href={`/admin/billing?repartidor=${f.id}`}
                        className="underline decoration-[var(--edr-yellow)] underline-offset-2"
                      >
                        {f.nombre}
                      </Link>
                      {f.diasSinCerrar > 0 && (
                        <div className="text-[11px] font-semibold text-[var(--edr-naranja-claro)]">
                          {f.diasSinCerrar} día(s) sin cerrar
                        </div>
                      )}
                    </td>
                    <td className="edr-mono px-3 py-2 text-right">{f.entregas}</td>
                    <td className="edr-mono px-3 py-2 text-right">{money(f.cobrado)}</td>
                    <td className="edr-mono px-3 py-2 text-right">{money(f.ganancia)}</td>
                    <td className="edr-mono px-3 py-2 text-right">{money(f.rendido)}</td>
                    <td
                      className="edr-mono px-3 py-2 text-right font-black"
                      style={{
                        color: f.saldo >= 0 ? 'var(--edr-rojo)' : 'var(--edr-verde)',
                      }}
                    >
                      {money(Math.abs(f.saldo))}
                      <div className="text-[10px] font-bold uppercase">
                        {f.saldo >= 0 ? 'debe rendir' : 'hay que pagarle'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <p className="mt-3 text-xs text-[var(--edr-muted)]">
            El saldo sale de lo cobrado menos lo rendido menos lo que le toca, dentro del período
            elegido. Un día sin cerrar cuenta como no rendido, que es la verdad: mientras nadie lo
            cerró, la plata la sigue teniendo el repartidor.
            <br />
            <strong>Para saber cuánto te debe cada uno de verdad, usá &quot;Acumulado&quot;</strong>
            : en una ventana de días el saldo mezcla períodos, porque alguien puede rendir el martes
            plata que cobró la semana pasada.
          </p>
        </>
      )}
    </main>
  );
}

function Tarjeta({ label, valor, tono }: { label: string; valor: string; tono?: 'ok' | 'warn' }) {
  const color =
    tono === 'ok'
      ? 'var(--edr-verde)'
      : tono === 'warn'
        ? 'var(--edr-rojo)'
        : 'var(--edr-text, inherit)';

  return (
    <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
        {label}
      </div>
      <div className="edr-mono text-2xl font-black" style={{ color }}>
        {valor}
      </div>
    </div>
  );
}
