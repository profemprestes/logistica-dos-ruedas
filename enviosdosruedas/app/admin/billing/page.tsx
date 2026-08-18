'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { notificarRepartidor } from '@/lib/notify';
import { money } from '@/lib/format';
import {
  dayRange,
  logCash,
  summarizeLogs,
  today,
  LOG_SELECT,
  type DeliveryLog,
} from '@/lib/settlement';

interface Driver {
  id: string;
  full_name: string;
  active: boolean;
}

interface Settlement {
  id: number;
  driver_id: string;
  day: string;
  delivered_count: number;
  failed_count: number;
  cash_total: number;
  /** Lo que el repartidor entregó de verdad; lo carga el admin a mano. */
  actual_amount: number | null;
  /** Valor bruto de los envíos del día, sin comisión. */
  shipping_total: number | null;
  /** Ganancia para la empresa, cargada a mano (ya con la comisión descontada). */
  earnings: number | null;
  notes: string | null;
  settled_at: string;
}

/** Las dos consultas del día, sin tocar el estado de React. */
async function fetchDay(driverId: string, day: string) {
  const { from, to } = dayRange(day);

  const [logsRes, settlementRes] = await Promise.all([
    supabase
      .from('delivery_logs')
      .select(LOG_SELECT)
      .eq('driver_id', driverId)
      .gte('happened_at', from)
      .lte('happened_at', to)
      .order('happened_at'),
    supabase
      .from('settlements')
      .select('*')
      .eq('driver_id', driverId)
      .eq('day', day)
      .maybeSingle(),
  ]);

  return { logsRes, settlementRes };
}

export default function BillingPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [day, setDay] = useState(today());
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [actual, setActual] = useState('');
  const [earnings, setEarnings] = useState('');
  const [cobrado, setCobrado] = useState('');
  const [envios, setEnvios] = useState('');

  useEffect(() => {
    if (!ready) return;
    supabase
      .from('profiles')
      .select('id, full_name, active')
      .eq('role', 'repartidor')
      .order('full_name')
      .then(({ data }) => {
        const list = (data ?? []) as Driver[];
        setDrivers(list);
        if (list.length && !driverId) setDriverId(list[0].id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const apply = useCallback(({ logsRes, settlementRes }: Awaited<ReturnType<typeof fetchDay>>) => {
    if (logsRes.error) {
      console.error('[liquidación] no se pudieron traer los movimientos', logsRes.error);
      setError(logsRes.error.message);
    } else {
      setError('');
    }

    const saved = (settlementRes.data ?? null) as Settlement | null;
    const rows = (logsRes.data ?? []) as unknown as DeliveryLog[];

    setLogs(rows);
    setSettlement(saved);
    setNotes(saved?.notes ?? '');
    // Arranca con lo que calculó el sistema; el admin lo pisa si rindió otra cosa.
    const calc = summarizeLogs(rows);
    /*
     * EL RENDIDO ARRANCA EN CERO, NO EN LO COBRADO.
     *
     * Arrancaba con el efectivo del día, o sea dando por hecho que el
     * repartidor entregó todo — y entonces el saldo nacía diciendo que no debía
     * nada. Justo al revés de lo que pasa: lo normal es que la plata la tenga
     * él hasta que la rinde, y rendir es un hecho que ocurre, no algo que se
     * supone. Se llena a mano cuando la entrega, que es cuando se sabe.
     *
     * Un día ya cerrado conserva lo que se guardó: esto es sólo el arranque.
     */
    setActual(String(saved?.actual_amount ?? 0));
    /*
     * Lo que le toca al repartidor arranca CALCULADO, no vacío.
     *
     * Hasta hoy este renglón se escribía a mano mientras los resúmenes lo
     * calculaban solos con las mismas reglas: dos pantallas del mismo sistema
     * podían decir cosas distintas sobre la misma plata, y la que se usaba para
     * pagar era la escrita a mano. Se sigue pudiendo pisar, como los otros.
     */
    setEarnings(
      saved?.earnings !== null && saved?.earnings !== undefined
        ? String(saved.earnings)
        : String(calc.driverEarnings),
    );
    // Estos dos salen de la cuenta del sistema, pero se pueden pisar a mano:
    // si el repartidor olvidó cargar algo, el cierre no puede quedar trabado.
    setCobrado(String(saved?.cash_total ?? calc.cashTotal));
    setEnvios(String(saved?.shipping_total ?? calc.shippingTotal));
    setLoading(false);
  }, []);

  /** Recarga a mano, después de liquidar o reabrir. */
  const reload = useCallback(() => {
    if (!driverId || !day) return Promise.resolve();
    setLoading(true);
    return fetchDay(driverId, day).then(apply);
  }, [driverId, day, apply]);

  useEffect(() => {
    if (!ready || !driverId || !day) return;
    let cancelled = false;
    fetchDay(driverId, day).then((res) => {
      if (!cancelled) apply(res);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, driverId, day, apply]);

  /* ------------------------------------------------------------- cálculos */
  const summary = summarizeLogs(logs);
  const {
    delivered,
    failed,
    cashFromPickups,
    cashTotal,
    shippingTotal,
    shippingMissing,
    driverEarnings,
    earningsNormales,
    earningsShippy,
    countShippy,
  } =
    summary;
  const driverName = drivers.find((d) => d.id === driverId)?.full_name ?? '';

  // Todos los renglones son editables: mandan los valores del formulario, y al
  // lado se muestra lo que había calculado el sistema para poder comparar.
  const declared = Number(actual) || 0;
  const cobradoNum = Number(cobrado) || 0;
  const enviosNum = Number(envios) || 0;
  const gananciaNum = Number(earnings) || 0;

  /**
   * Los entregados que quedaron sin valor de envío cargado.
   *
   * Se muestran con nombre y apellido y no como un número: "3 sin valor" es un
   * dato; tres códigos con su comercio y su dirección es algo que se puede
   * arreglar en dos minutos antes de cerrar el día.
   */
  const sinValor = delivered.filter((l) => !Number(l.shipment?.shipping_fee));

  /* -------------------------------------------------------------- acciones */
  async function settle() {
    if (!driverId) return;
    setError('');

    /*
     * Sin sesión no se intenta siquiera.
     *
     * El 13/08/2026 el cierre falló con "new row violates row-level security
     * policy for table settlements", que no le dice nada a nadie. La causa era
     * ésta: la pestaña llevaba horas abierta y se había quedado sin sesión, así
     * que lo que llegaba a la base era un anónimo. Como anónimo no sos admin, y
     * el permiso —bien puesto— rechaza la escritura.
     *
     * Costó encontrarlo porque el mensaje apunta al permiso, que era lo único
     * que estaba bien. Un aviso claro acá habría ahorrado la vuelta entera.
     */
    const { data: me } = await supabase.auth.getUser();
    if (!me.user) {
      setError('Se cerró tu sesión. Recargá la página, volvé a entrar y cerrá la caja de nuevo.');
      return;
    }

    const { error: dbError } = await supabase.from('settlements').upsert(
      {
        driver_id: driverId,
        day,
        delivered_count: delivered.length,
        failed_count: failed.length,
        cash_total: cobradoNum,
        actual_amount: declared,
        shipping_total: enviosNum,
        earnings: earnings.trim() === '' ? null : gananciaNum,
        notes: notes || null,
        settled_at: new Date().toISOString(),
        settled_by: me.user?.id ?? null,
      },
      { onConflict: 'driver_id,day' },
    );

    if (dbError) {
      console.error('[liquidación] no se pudo cerrar el día', dbError);
      setError(
        // Por si la sesión se cayó entre el control de arriba y esta línea, o
        // si algún día se rompe un permiso de verdad: que el cartel diga qué
        // hacer, y no cómo se llama la tabla.
        dbError.message.includes('row-level security')
          ? 'La base rechazó el cierre. Suele ser la sesión: recargá la página, volvé a entrar y probá de nuevo.'
          : dbError.message,
      );
      return;
    }

    const saldo = cobradoNum - declared - gananciaNum;
    void notificarRepartidor({
      driverId,
      title: 'Se cerró tu caja del día',
      body:
        saldo >= 0
          ? `Te queda por rendir ${money(saldo)}. Miralo en "Mi perfil".`
          : `Se te debe ${money(Math.abs(saldo))}. Miralo en "Mi perfil".`,
      url: '/driver/profile',
      tag: `caja-${day}`,
    });

    await reload();
  }

  async function reopen() {
    if (!settlement) return;
    if (!confirm('¿Reabrir el día? Vas a poder volver a liquidarlo después.')) return;
    const { error: dbError } = await supabase
      .from('settlements')
      .delete()
      .eq('id', settlement.id);
    if (dbError) setError(dbError.message);
    else await reload();
  }

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  return (
    <div className="min-h-full">

      <main className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Repartidor
            </label>
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm"
            >
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} {d.active ? '' : '(inactivo)'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Día
            </label>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={() => setDay(today())}
            className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
          >
            Hoy
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Entregados
            </div>
            <div className="edr-mono text-3xl font-black">{delivered.length}</div>
          </div>
          <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              No entregados
            </div>
            <div className="edr-mono text-3xl font-black text-orange-700">{failed.length}</div>
          </div>
          <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Cobrado al retirar
            </div>
            <div className="edr-mono text-2xl font-black">{money(cashFromPickups)}</div>
          </div>
          {/* Fondo amarillo: el texto va negro sí o sí. Con el color heredado
              del cuerpo (que es amarillo) quedaba invisible. */}
          <div className="rounded-lg border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] p-4 text-[var(--edr-blue)]">
            <div className="text-[11px] font-semibold uppercase tracking-wide">
              Efectivo a rendir
            </div>
            <div className="edr-mono text-3xl font-black">{money(cashTotal)}</div>
          </div>

          {/* Base para calcular la ganancia: es lo mismo que ve el repartidor. */}
          <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4 lg:col-span-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Valor de los envíos entregados (bruto, sin comisión)
            </div>
            <div className="edr-mono text-3xl font-black">{money(shippingTotal)}</div>
            {shippingMissing > 0 && (
              <div className="mt-1 text-[11px] font-bold text-[var(--edr-acento)]">
                {shippingMissing} envío(s) sin valor cargado: cuentan $0 hasta que los completes.
              </div>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------- cierre del día */}
        <div className="mb-6 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-5">
          {settlement ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="rounded bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-900 ring-1 ring-emerald-300">
                Día liquidado
              </div>
              <div className="text-sm text-[var(--edr-muted)]">
                {delivered.length} entregas · calculado{' '}
                {money(Number(settlement.cash_total))} · rendido{' '}
                <strong className="edr-mono">
                  {money(Number(settlement.actual_amount ?? settlement.cash_total))}
                </strong>{' '}
                · cerrado el {new Date(settlement.settled_at).toLocaleString('es-AR')}
              </div>

              {settlement.actual_amount !== null &&
                Number(settlement.actual_amount) !== Number(settlement.cash_total) && (
                  <div className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                    Ajuste manual:{' '}
                    {money(Number(settlement.actual_amount) - Number(settlement.cash_total))}{' '}
                    respecto de lo calculado.
                  </div>
                )}

              {settlement.earnings !== null && (
                <div className="w-full rounded border border-[var(--edr-yellow)] px-3 py-2 text-sm font-bold">
                  Ganancia del día: {money(Number(settlement.earnings))}
                  {settlement.shipping_total !== null && (
                    <span className="ml-2 font-semibold text-[var(--edr-muted)]">
                      (bruto {money(Number(settlement.shipping_total))})
                    </span>
                  )}
                </div>
              )}

              {settlement.notes && (
                <div className="w-full text-sm text-[var(--edr-muted)]">Nota: {settlement.notes}</div>
              )}

              {Math.abs(Number(settlement.cash_total) - cashTotal) > 0.5 && (
                <div className="w-full rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
                  Ojo: hubo movimientos después del cierre. Liquidaste{' '}
                  {money(Number(settlement.cash_total))} y ahora el día suma {money(cashTotal)}.
                </div>
              )}

              <button
                onClick={reopen}
                className="ml-auto rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
              >
                Reabrir día
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Mismo orden y mismos nombres que ve el repartidor en su celular:
                  si los dos leen lo mismo, no hay discusión al rendir. */}
              <div className="mx-auto max-w-xl space-y-2">
                <Renglon
                  label="Efectivo cobrado"
                  hint={cobradoNum !== cashTotal ? `el sistema calculó ${money(cashTotal)}` : undefined}
                  input={
                    <input
                      type="number"
                      value={cobrado}
                      onChange={(e) => setCobrado(e.target.value)}
                      className="edr-mono w-40 rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] px-3 py-1.5 text-right text-lg font-black outline-none"
                    />
                  }
                />

                <Renglon
                  label="Efectivo rendido / pagado"
                  input={
                    <input
                      type="number"
                      value={actual}
                      onChange={(e) => setActual(e.target.value)}
                      className="edr-mono w-40 rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] px-3 py-1.5 text-right text-lg font-black outline-none"
                    />
                  }
                />

                <Renglon
                  label="Envíos totales (sin comisión)"
                  hint={
                    enviosNum !== shippingTotal
                      ? `el sistema calculó ${money(shippingTotal)}`
                      : shippingMissing > 0
                        ? `${shippingMissing} envío(s) sin valor cargado`
                        : undefined
                  }
                  input={
                    <input
                      type="number"
                      value={envios}
                      onChange={(e) => setEnvios(e.target.value)}
                      className="edr-mono w-40 rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] px-3 py-1.5 text-right text-lg font-black outline-none"
                    />
                  }
                />

                {/*
                  CUÁLES quedaron sin valor, no cuántos.
                  
                  El contador decía "3 envío(s) sin valor cargado" y había que
                  ir a buscarlos a la tabla uno por uno, así que se cerraba el
                  día igual y esos tres se pagaban en cero. Con los códigos acá
                  se completan antes de cerrar, que es el único momento en que
                  alguien los está mirando.
                */}
                {sinValor.length > 0 && (
                  <div className="rounded border-2 border-orange-300 bg-orange-50 px-3 py-2.5 text-sm text-orange-900">
                    <div className="font-black">
                      {sinValor.length} entregado(s) sin valor de envío — se pagan $0
                    </div>
                    <ul className="mt-1.5 space-y-1">
                      {sinValor.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-x-2">
                          <a
                            href={`/admin?buscar=${encodeURIComponent(l.shipment?.tracking_code ?? '')}`}
                            className="edr-mono font-bold underline"
                          >
                            {l.shipment?.tracking_code}
                          </a>
                          <span className="text-orange-800">
                            {l.shipment?.client_name_raw ?? ''} · {l.shipment?.address_street ?? ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-xs">
                      Cargales el valor y volvé a esta pantalla: el cálculo se rehace solo.
                    </p>
                  </div>
                )}

                <Renglon
                  label="Envíos a cobrar (comisión descontada)"
                  hint={
                    gananciaNum !== driverEarnings
                      ? `el sistema calculó ${money(driverEarnings)}`
                      : countShippy > 0
                        ? `${money(earningsNormales)} al 70% + ${money(earningsShippy)} de ${countShippy} Shippy (sin comisión)`
                        : `${money(shippingTotal)} menos el 30% de comisión`
                  }
                  input={
                    <input
                      type="number"
                      value={earnings}
                      onChange={(e) => setEarnings(e.target.value)}
                      placeholder="0"
                      className="edr-mono w-40 rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] px-3 py-1.5 text-right text-lg font-black outline-none"
                    />
                  }
                />

                <div className="border-t-2 border-[var(--edr-yellow)] pt-3">
                  {(() => {
                    const saldo = cobradoNum - declared - gananciaNum;
                    const debe = saldo >= 0;
                    return (
                      <div
                        className={`rounded-lg px-4 py-3 text-center ${
                          debe ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <div className="text-xs font-black uppercase tracking-widest">
                          {debe ? 'Total a rendir' : 'Total a cobrar'}
                        </div>
                        <div className="edr-mono text-3xl font-black leading-none">
                          {money(Math.abs(saldo))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
                  Observaciones
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej: gastó $2000 en nafta, quedó debiendo $500"
                  className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setCobrado(String(cashTotal));
                    setEnvios(String(shippingTotal));
                    // Rehacer las cuentas del sistema no puede inventar una
                    // rendición que no pasó: vuelve a cero, como al abrir.
                    setActual('0');
                    setEarnings(String(driverEarnings));
                  }}
                  className="rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
                >
                  Volver a lo calculado
                </button>
                <button
                  onClick={settle}
                  disabled={!logs.length}
                  className="rounded bg-[var(--edr-yellow)] px-5 py-2.5 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-40"
                >
                  Marcar día como liquidado
                </button>
              </div>
            </div>
          )}
        </div>

        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-[var(--edr-muted)]">
          Movimientos de {driverName || 'el repartidor'} el {day}
        </h2>

        <div className="overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--edr-border)] bg-[var(--edr-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--edr-muted)]">
              <tr>
                <th className="px-3 py-2">Hora</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Destinatario</th>
                <th className="px-3 py-2">Movimiento</th>
                <th className="px-3 py-2 text-right">Efectivo</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                    Cargando…
                  </td>
                </tr>
              )}

              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                    Sin movimientos ese día.
                  </td>
                </tr>
              )}

              {logs.map((l) => {
                const cash = logCash(l);

                return (
                  <tr key={l.id} className="border-b border-[var(--edr-border)] last:border-0">
                    <td className="edr-mono px-3 py-2 text-xs">
                      {new Date(l.happened_at).toLocaleTimeString('es-AR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="edr-mono px-3 py-2 text-xs">
                      {l.shipment?.tracking_code ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div>{l.shipment?.recipient_name ?? '—'}</div>
                      <div className="text-xs text-[var(--edr-muted)]">{l.shipment?.address_street}</div>
                    </td>
                    <td className="px-3 py-2">
                      {l.event === 'entregado' && (
                        <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-300">
                          Entregado
                        </span>
                      )}
                      {l.event === 'no_entregado' && (
                        <span className="rounded bg-orange-50 px-2 py-0.5 text-xs font-semibold text-orange-900 ring-1 ring-orange-400">
                          No entregado{l.failure_reason ? ` · ${l.failure_reason}` : ''}
                        </span>
                      )}
                      {l.event === 'retirado' && (
                        <span className="rounded bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 ring-1 ring-sky-300">
                          Retirado
                        </span>
                      )}
                    </td>
                    <td className="edr-mono px-3 py-2 text-right font-semibold">
                      {cash > 0 ? money(cash) : <span className="text-[var(--edr-muted)]">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

/** Un renglón del cierre, con el número a la derecha (o un campo editable). */
function Renglon({
  label,
  value,
  input,
  hint,
}: {
  label: string;
  value?: string;
  input?: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--edr-border)] pb-2">
      <div>
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-[11px] text-[var(--edr-acento)]">{hint}</div>}
      </div>
      {input ?? <div className="edr-mono text-lg font-black">{value}</div>}
    </div>
  );
}
