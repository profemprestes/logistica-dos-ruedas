'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { money } from '@/lib/format';
import {
  customRange,
  dayShift,
  conLosMovimientos,
  summarizeLogs,
  today,
  weekRange,
  type DeliveryLog,
} from '@/lib/settlement';
import { ARRANCA, traerBilleteras } from '@/lib/billetera';

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
 * DOS NÚMEROS QUE NUNCA SE RESTAN ENTRE SÍ, y es la corrección de fondo de
 * esta pantalla:
 *
 *   · LO QUE EL PERÍODO GENERÓ — cobró, su parte, y lo que quedó a rendir por
 *     esos días. Sale de las entregas y no depende de cuándo pague.
 *   · EL SALDO DE LA CUENTA — lo que debe HOY, desde que arranca la caja.
 *     Sale de la billetera, entera, sin recortarla al período.
 *
 * Antes el saldo se calculaba dentro de la ventana: cobrado menos rendido
 * menos su parte, todo del período. Y eso miente siempre, porque la plata se
 * entrega DESPUÉS de que el período cerró. El caso real: el lunes 24/08
 * Emiliano entregó los $ 26.280 de la semana del 17 al 23, y la semana nueva
 * arrancó mostrando ese descuento como si fuera de ella.
 *
 * Una rendición no pertenece a ningún período —puede ser a cuenta, de un día
 * suelto, o de dos semanas juntas— así que no se la reparte: se la deja en la
 * cuenta corriente, que es donde vive.
 */

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/**
 * Los períodos que se miran de verdad.
 *
 * LA SEMANA VA PRIMERO porque es la que cierra la caja: el día es control
 * diario, pero la plata se rinde por semana, y ese cierre se hace el lunes o
 * el martes siguiente. "Semana pasada" es la pantalla de ese momento.
 *
 * Lunes a domingo, igual que los resúmenes (`weekRange`). Si acá se cortara
 * distinto, dos pantallas dirían dos semanas para los mismos días.
 */
const ATAJOS: { label: string; rango: () => { desde: string; hasta: string } }[] = [
  {
    label: 'Semana pasada',
    rango: () => {
      const s = weekRange(dayShift(today(), -7));
      return { desde: s.desde, hasta: s.hasta };
    },
  },
  {
    label: 'Esta semana',
    rango: () => {
      const s = weekRange(today());
      return { desde: s.desde, hasta: s.hasta };
    },
  },
  { label: 'Hoy', rango: () => ({ desde: today(), hasta: today() }) },
  {
    label: 'Ayer',
    rango: () => ({ desde: dayShift(today(), -1), hasta: dayShift(today(), -1) }),
  },
  { label: 'Este mes', rango: () => ({ desde: `${today().slice(0, 7)}-01`, hasta: today() }) },
  /*
   * Desde que arranca la caja y no desde siempre: antes del 17/08/2026 el
   * sistema se estaba probando y esos números son de ensayo. Es la misma
   * fecha que usa la billetera, así que el período largo y el saldo hablan
   * del mismo principio.
   */
  {
    label: `Desde el ${ARRANCA.split('-').reverse().slice(0, 2).join('/')}`,
    rango: () => ({ desde: ARRANCA, hasta: today() }),
  },
];

interface Fila {
  id: string;
  nombre: string;
  entregas: number;
  cobrado: number;
  ganancia: number;
  /** Lo que el período dejó a rendir: cobró menos su parte. Sin restar entregas. */
  aRendir: number;
  /**
   * Lo que debe HOY, de la billetera entera. Positivo: tiene plata nuestra.
   * Negativo: le debemos. No se recorta al período: un saldo es de ahora.
   */
  saldoHoy: number;
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
    aRendir: 0,
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
        conLosMovimientos<(DeliveryLog & { driver_id: string })[]>((select) =>
          supabase
            .from('delivery_logs')
            .select(`${select}, driver_id`)
            .gte('happened_at', from)
            .lte('happened_at', to),
        ),
        supabase
          .from('settlements')
          .select('driver_id, day')
          .gte('day', a)
          .lte('day', b),
      ]);

      if (!vivo) return;

      if (logs.error || drivers.error) {
        setError(logs.error?.message ?? drivers.error?.message ?? 'No se pudo traer la caja.');
        setCargando(false);
        return;
      }

      const todos = logs.data ?? [];

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
      for (const c of cierres.data ?? []) {
        const s = cerrados.get(c.driver_id) ?? new Set<string>();
        s.add(c.day);
        cerrados.set(c.driver_id, s);
      }

      /*
       * El saldo sale de la billetera ENTERA, no del período elegido.
       *
       * Es la diferencia que arregla esta pantalla: mirando la semana pasada,
       * el saldo que importa no es el que daría esa semana sola, es lo que el
       * repartidor debe hoy — que puede haber quedado en cero justamente
       * porque el lunes vino y pagó.
       */
      const cuentas = await traerBilleteras((drivers.data ?? []).map((d) => d.id));
      if (!vivo) return;

      const armadas: Fila[] = [];
      const suma = {
        cobrado: 0,
        ganancia: 0,
        aRendir: 0,
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

        /*
         * Lo que el período dejó a rendir: lo que cobró en la calle menos lo
         * que es suyo. Y punto — acá no se resta nada de lo que haya
         * entregado, porque lo que entregó no es de este período.
         */
        const aRendir = r.cashTotal - r.driverEarnings;

        const conMov = diasConMovimiento.get(d.id) ?? new Set<string>();
        const cerradosSuyos = cerrados.get(d.id) ?? new Set<string>();
        const sinCerrar = [...conMov].filter((x) => !cerradosSuyos.has(x)).length;

        armadas.push({
          id: d.id,
          nombre: d.full_name,
          entregas: r.delivered.length,
          cobrado: r.cashTotal,
          ganancia: r.driverEarnings,
          aRendir,
          saldoHoy: cuentas.get(d.id)?.saldo ?? 0,
          diasSinCerrar: sinCerrar,
        });

        suma.cobrado += r.cashTotal;
        suma.ganancia += r.driverEarnings;
        suma.aRendir += aRendir;
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
  // Los dos de abajo son de HOY y no del período: son posiciones de la cuenta.
  const enLaCalle = filas.reduce((acc, f) => acc + Math.max(0, f.saldoHoy), 0);
  const aPagar = filas.reduce((acc, f) => acc + Math.max(0, -f.saldoHoy), 0);

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
                  const r = x.rango();
                  setDesde(r.desde);
                  setHasta(r.hasta);
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
            <Tarjeta label="Quedó a rendir" valor={money(totales.aRendir)} />
            {/* Estos dos son de HOY, no del período: es la posición de la
                cuenta, la que dice a quién hay que ir a buscar. */}
            <Tarjeta label="Tienen que rendir hoy" valor={money(enLaCalle)} tono="warn" />
            <Tarjeta label="Hay que pagarles hoy" valor={money(aPagar)} tono="ok" />
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
                  <th className="px-3 py-2 text-right">Quedó a rendir</th>
                  <th className="px-3 py-2 text-right">Saldo hoy</th>
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
                    <td className="edr-mono px-3 py-2 text-right font-bold">
                      {money(f.aRendir)}
                    </td>
                    {/* El saldo NO es del período: es lo que debe hoy. Por eso
                        puede decir cero mirando una semana en la que cobró
                        mucho — porque después vino y pagó. */}
                    <td
                      className="edr-mono px-3 py-2 text-right font-black"
                      style={{
                        color:
                          f.saldoHoy === 0
                            ? 'var(--edr-muted)'
                            : f.saldoHoy > 0
                              ? 'var(--edr-rojo)'
                              : 'var(--edr-verde)',
                      }}
                    >
                      {money(Math.abs(f.saldoHoy))}
                      <div className="text-[10px] font-bold uppercase">
                        {f.saldoHoy === 0
                          ? 'al día'
                          : f.saldoHoy > 0
                            ? 'debe rendir'
                            : 'hay que pagarle'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <p className="mt-3 text-xs leading-relaxed text-[var(--edr-muted)]">
            <strong>&quot;Quedó a rendir&quot; es del período</strong>: lo que cobró en esos días
            menos lo que es suyo. No le resta las entregas de plata, porque una entrega no
            pertenece a ninguna semana — puede ser a cuenta, de un día suelto o de dos semanas
            juntas.
            <br />
            <strong>&quot;Saldo hoy&quot; es de la cuenta</strong>: lo que debe ahora, desde que
            arranca la caja, contando todo lo que entregó y todo lo que se le pagó. Por eso una
            semana con mucho cobrado puede tener saldo cero: cerró y vino a pagar.
            <br />
            Las entregas de plata se anotan y se corrigen en{' '}
            <Link href="/admin/billetera" className="underline underline-offset-2">
              la Billetera
            </Link>
            .
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
