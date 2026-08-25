'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { notificarRepartidor } from '@/lib/notify';
import { money, nombreDelDestinatario } from '@/lib/format';
import { anotar as anotarEnLaBilletera } from '@/lib/billetera';
import {
  dayRange,
  logCash,
  summarizeLogs,
  today,
  conLosMovimientos,
  fueCorregido,
  sinPrecio,
  type DeliveryLog,
} from '@/lib/settlement';

const field =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--edr-acento)] focus:ring-2 focus:ring-[var(--edr-yellow)]/10';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

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

  const [logsRes, settlementRes, rendicionesRes] = await Promise.all([
    conLosMovimientos<DeliveryLog[]>((select) =>
      supabase
        .from('delivery_logs')
        .select(select)
        .eq('driver_id', driverId)
        .gte('happened_at', from)
        .lte('happened_at', to)
        .order('happened_at'),
    ),
    supabase
      .from('settlements')
      .select('*')
      .eq('driver_id', driverId)
      .eq('day', day)
      .maybeSingle(),
    /*
     * Lo que entregó ESE día, según la billetera (paso 55).
     *
     * Puede ser cero aunque haya cobrado mucho: lo normal es que junte varios
     * días y entregue todo junto otro día. El saldo de verdad está en la
     * Billetera; acá sólo se muestra lo de la jornada.
     */
    supabase
      .from('movimientos_caja')
      .select('monto')
      .eq('driver_id', driverId)
      .eq('fecha', day)
      .eq('tipo', 'rendicion'),
  ]);

  return { logsRes, settlementRes, rendicionesRes };
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
  /** Lo que entregó ese día según la billetera. Acá no se edita. */
  const [rendidoEnLaBilletera, setRendido] = useState(0);
  const [earnings, setEarnings] = useState('');
  const [cobrado, setCobrado] = useState('');
  const [envios, setEnvios] = useState('');
  /** El movimiento al que se le está corrigiendo lo cobrado (paso 54). */
  const [corrigiendo, setCorrigiendo] = useState<DeliveryLog | null>(null);
  const [montoReal, setMontoReal] = useState('');
  const [notaCorreccion, setNotaCorreccion] = useState('');
  const [guardandoCorreccion, setGuardandoCorreccion] = useState(false);
  /** El cuadro para anotar que entregó la plata (paso 55). */
  const [anotandoRendicion, setAnotandoRendicion] = useState(false);
  const [montoRendido, setMontoRendido] = useState('');
  const [guardandoRendicion, setGuardandoRendicion] = useState(false);

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

  const apply = useCallback(
    ({ logsRes, settlementRes, rendicionesRes }: Awaited<ReturnType<typeof fetchDay>>) => {
    if (logsRes.error) {
      console.error('[liquidación] no se pudieron traer los movimientos', logsRes.error);
      setError(logsRes.error.message);
    } else {
      setError('');
    }

    const saved = (settlementRes.data ?? null) as Settlement | null;
    const rows = logsRes.data ?? [];

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
    setRendido(
      (rendicionesRes.data ?? []).reduce((acc, m) => acc + Number(m.monto), 0),
    );
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
    },
    [],
  );

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
  const sinValor = delivered.filter(sinPrecio);

  /* -------------------------------------------------------------- acciones */

  /**
   * Corrige lo que se cobró de verdad en un movimiento ya cerrado.
   *
   * EL CASO. El 20/08/2026 un envío salió con $ 65.230 a cobrar y en la puerta
   * se terminó cobrando $ 36.900. El repartidor cerró con el monto que traía el
   * envío, así que la caja le pedía rendir $ 28.330 que nunca tuvo en la mano.
   *
   * No se toca el número que él cargó: la corrección se guarda al lado, con
   * quién la hizo y por qué (paso 54). El día que haya una discusión de plata,
   * tiene que quedar rastro de quién dijo qué.
   */
  async function guardarCorreccion() {
    if (!corrigiendo) return;

    const monto = Number(montoReal);
    if (!Number.isFinite(monto) || monto < 0) {
      setError('Poné cuánto se cobró de verdad, en números.');
      return;
    }

    setGuardandoCorreccion(true);
    setError('');

    const { error: e } = await supabase.rpc('corregir_cobrado', {
      p_log: corrigiendo.id,
      p_monto: monto,
      p_nota: notaCorreccion.trim() || null,
    });

    setGuardandoCorreccion(false);

    if (e) {
      setError(
        /corregir_cobrado/.test(e.message)
          ? 'Falta correr el paso 54 en la base. Hasta entonces no se puede corregir lo cobrado.'
          : e.message === 'SOLO_ADMIN'
            ? 'Sólo la oficina puede corregir lo cobrado.'
            : e.message,
      );
      return;
    }

    setCorrigiendo(null);
    await reload();
  }

  /**
   * Anota acá mismo que entregó la plata.
   *
   * POR QUÉ EL BOTÓN VIVE EN EL CIERRE. Cerrar el día y recibir la plata son
   * dos actos distintos —se puede cerrar el día sin que haya entregado nada— y
   * por eso la billetera no se mueve sola al liquidar. Pero el momento en que
   * suele entregarla es justo éste, con el admin mirando la cuenta del día: si
   * para anotarlo hubiera que cambiar de pantalla, no se anotaría.
   */
  async function guardarRendicion() {
    setGuardandoRendicion(true);
    setError('');

    const r = await anotarEnLaBilletera({
      driverId,
      fecha: day,
      tipo: 'rendicion',
      monto: Number(montoRendido),
      nota: 'Anotado al cerrar el día',
    });

    setGuardandoRendicion(false);

    if (r.error) {
      setError(r.error);
      return;
    }

    setAnotandoRendicion(false);
    await reload();
  }

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
        /*
         * `actual_amount` NO SE ESCRIBE MÁS.
         *
         * Era lo rendido, guardado adentro del cierre de un día. Pero una
         * entrega de plata no pertenece a ningún día: se hace después, junta
         * varias jornadas, y a veces es sólo a cuenta. Escribirla acá era
         * volver a atarla a una fecha que no es la suya — justo lo que el paso
         * 55 vino a deshacer.
         *
         * La columna se deja en la base con lo que ya tenía, como historia. No
         * la lee nadie: ni esta pantalla, ni la caja del repartidor.
         */
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

    /*
     * Lo que ESE DÍA dejó a rendir, sin descontarle entregas de plata.
     *
     * Antes le restaba lo anotado en la billetera con fecha de ese día, y
     * entonces el aviso le decía "no te queda nada por rendir" a alguien que
     * ese mismo día había venido a pagar lo de la semana anterior.
     */
    const aRendir = cobradoNum - gananciaNum;
    void notificarRepartidor({
      driverId,
      title: 'Se cerró tu caja del día',
      body:
        aRendir >= 0
          ? `El día te dejó ${money(aRendir)} para rendir. Miralo en "Mi perfil".`
          : `Se te debe ${money(Math.abs(aRendir))}. Miralo en "Mi perfil".`,
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
              del cuerpo (que es amarillo) quedaba invisible.

              Dice "cobrado" y no "a rendir": esto es el bruto del día, y lo
              que se rinde es el neto —menos su parte— que está abajo de todo
              como "Total a rendir". Dos carteles de rendir con montos
              distintos ya confundieron una vez. */}
          <div className="rounded-lg border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] p-4 text-[var(--edr-blue)]">
            <div className="text-[11px] font-semibold uppercase tracking-wide">
              Efectivo cobrado
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
                {delivered.length} entregas · cobró {money(Number(settlement.cash_total))} · quedó
                a rendir{' '}
                <strong className="edr-mono">
                  {money(Number(settlement.cash_total) - gananciaNum)}
                </strong>{' '}
                · cerrado el {new Date(settlement.settled_at).toLocaleString('es-AR')}
                {/* Lo entregado con fecha de este día se dice aparte y en gris:
                    es un dato de la cuenta corriente que pasó por acá, no una
                    parte de lo que este día dejó a rendir. */}
                {rendidoEnLaBilletera > 0 && (
                  <div className="mt-1 text-xs">
                    Con fecha de este día entregó{' '}
                    <strong className="edr-mono">{money(rendidoEnLaBilletera)}</strong> — va a la{' '}
                    <Link
                      href={`/admin/billetera?repartidor=${driverId}`}
                      className="underline underline-offset-2"
                    >
                      cuenta corriente
                    </Link>
                    , no a este día.
                  </div>
                )}
              </div>

              {/*
                ANOTAR LA RENDICIÓN CON EL DÍA YA CERRADO.

                Antes este botón vivía sólo en el formulario, que desaparece al
                liquidar. Así que para anotar que le entregó la plata había que
                REABRIR EL DÍA —y reabrir borra el cierre—. Rendir es lo que
                pasa DESPUÉS de cerrar: es el orden normal, no la excepción.
              */}
              <button
                onClick={() => {
                  setAnotandoRendicion(true);
                  // En NETO: el efectivo del cierre menos su parte, que es lo
                  // que él trae de verdad. Su comisión ya quedó en su bolsillo.
                  setMontoRendido(
                    String(
                      Math.max(
                        0,
                        Number(settlement.cash_total) - gananciaNum - rendidoEnLaBilletera,
                      ),
                    ),
                  );
                }}
                className="rounded border border-[var(--edr-yellow)] px-3 py-1.5 text-sm font-bold text-[var(--edr-acento)] hover:bg-[var(--edr-surface-2)]"
              >
                Anotar que rindió
              </button>

              {/*
                ACÁ IBA "de ese día quedan X sin rendir", y era la mezcla en su
                forma más pura: comparaba lo que el día dejó a rendir contra las
                entregas de plata FECHADAS ese día. Nunca coincidían, y no tenían
                por qué — la plata se entrega después, junta varias jornadas, y a
                veces es sólo a cuenta.

                Un día no se salda solo. Lo que falta rendir es uno para todo:
                el saldo de la cuenta, que vive en la Billetera.
              */}

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

                {/*
                  LO RENDIDO NO ES UN RENGLÓN DEL CIERRE, y por eso está fuera
                  de la cuenta del día.

                  Era un campo del cierre de UN DÍA, y la plata no se entrega
                  por día: el repartidor junta lo de varias jornadas y deja un
                  monto que cubre todo. Escrito acá quedaba pegado a un día al
                  que no pertenece — el 12/08/2026 quedó "cobró $ 9.900, rindió
                  $ 55.000", y el lunes 24/08 el día arrancó con un descuento de
                  $ 26.280 que era de la semana anterior.

                  El botón se queda porque este es el momento en que se anota,
                  pero lo que muestra es un movimiento de la CUENTA con fecha de
                  hoy, no una parte de este día. Por eso no se resta de nada.
                */}
                <Renglon
                  label="Entregas de plata con fecha de este día"
                  hint="van a la cuenta corriente, no a la cuenta de este día"
                  input={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="edr-mono text-lg font-black">
                        {money(rendidoEnLaBilletera)}
                      </span>
                      <button
                        onClick={() => {
                          setAnotandoRendicion(true);
                          // Arranca con lo que falta del día EN NETO: cobrado
                          // menos su parte, que es la plata que él trae de
                          // verdad. Volver a escribirla es una oportunidad de
                          // equivocarse.
                          setMontoRendido(
                            String(Math.max(0, cobradoNum - gananciaNum - rendidoEnLaBilletera)),
                          );
                        }}
                        className="rounded border border-[var(--edr-yellow)] px-2.5 py-1 text-xs font-bold text-[var(--edr-acento)] hover:bg-[var(--edr-surface-2)]"
                      >
                        Anotar que rindió
                      </button>
                      {/* Sin este link, el número se ve y no se puede tocar: no
                          se corrige ni se borra desde acá, y no había forma de
                          saber adónde ir. */}
                      <Link
                        href={`/admin/billetera?repartidor=${driverId}`}
                        className="text-xs font-bold text-[var(--edr-acento)] underline underline-offset-2"
                      >
                        ver en la Billetera →
                      </Link>
                    </div>
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
                  {/*
                    LO QUE ESTE DÍA DEJÓ, y no lo que falta que entregue.

                    Antes le restaba las entregas de plata fechadas ese día, así
                    que un lunes en que el repartidor vino a pagar lo de la
                    semana anterior este cartel decía cero aunque hubiera cobrado
                    setenta mil en la calle. Cuánto falta que entregue es una
                    pregunta de la cuenta, no del día, y se contesta en la
                    Billetera.
                  */}
                  {(() => {
                    const delDia = cobradoNum - gananciaNum;
                    const debe = delDia >= 0;
                    return (
                      <div
                        className={`rounded-lg px-4 py-3 text-center ${
                          debe ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <div className="text-xs font-black uppercase tracking-widest">
                          {debe ? 'Este día dejó a rendir' : 'Este día hay que pagarle'}
                        </div>
                        <div className="edr-mono text-3xl font-black leading-none">
                          {money(Math.abs(delDia))}
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
                    setEarnings(String(driverEarnings));
                    // Lo rendido no se toca: no es una cuenta del sistema sino
                    // un hecho anotado en la Billetera.
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
                <th className="px-3 py-2 text-right"></th>
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
                      <div>{l.shipment ? nombreDelDestinatario(l.shipment) : '—'}</div>
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
                      {/* Lo que el repartidor cargó, tachado, cuando se
                          corrigió. Sin esto la corrección es invisible y el
                          número nuevo parece salido de la nada. */}
                      {fueCorregido(l) && (
                        <div
                          className="text-[10px] font-normal text-[var(--edr-muted)]"
                          title={l.correccion_nota ?? 'Corregido desde la oficina'}
                        >
                          <s>{money(Number(l.amount_collected ?? 0))}</s> corregido
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      {/* Sólo donde pudo entrar plata: en un "no entregado" no
                          se cobró nada y no hay nada que corregir. */}
                      {(l.event === 'entregado' || l.event === 'retirado') && (
                        <button
                          onClick={() => {
                            setCorrigiendo(l);
                            setMontoReal(String(cash));
                            setNotaCorreccion(l.correccion_nota ?? '');
                          }}
                          title="Si en la puerta se cobró otra cosa, corregilo acá"
                          className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                        >
                          Corregir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {/* Anotar que entregó la plata (paso 55) */}
      {anotandoRendicion && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-10 w-full max-w-md rounded-lg bg-[var(--edr-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
              <h2 className="text-lg font-bold">¿Cuánto te entregó {driverName}?</h2>
              <button
                onClick={() => setAnotandoRendicion(false)}
                className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 px-5 py-5">
              <p className="text-sm text-[var(--edr-muted)]">
                Ese día cobró <strong className="edr-mono">{money(cobradoNum)}</strong> y su parte
                es <strong className="edr-mono">{money(gananciaNum)}</strong>: quedaron{' '}
                <strong className="edr-mono">{money(Math.max(0, cobradoNum - gananciaNum))}</strong>{' '}
                a rendir por ese día.
                {/* Se aclara "con fecha de ese día" y no "de esos": lo anotado
                    puede cubrir cualquier jornada, y el monto de acá arriba es
                    sólo el punto de partida del campo. */}
                {rendidoEnLaBilletera > 0 && (
                  <>
                    {' '}
                    Con esa fecha ya hay anotados{' '}
                    <span className="edr-mono">{money(rendidoEnLaBilletera)}</span>.
                  </>
                )}
              </p>

              <div>
                <label className={labelCls}>Cuánto entregó</label>
                <input
                  className={field}
                  inputMode="numeric"
                  value={montoRendido}
                  onChange={(e) => setMontoRendido(e.target.value)}
                  placeholder="50000"
                />
              </div>

              {/* Que la fecha sea la del día que se está cerrando es lo normal,
                  pero no siempre: si entregó hoy lo del lunes, la entrega es de
                  hoy. Para eso está la Billetera, y lo dice acá. */}
              <p className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-xs text-[var(--edr-muted)]">
                Se anota con fecha <strong>{day.split('-').reverse().join('/')}</strong>, el día que
                estás cerrando. Si te la entregó otro día, anotalo desde la Billetera para ponerle
                la fecha que corresponde.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
              <button
                onClick={() => setAnotandoRendicion(false)}
                className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
              >
                Cancelar
              </button>
              <button
                onClick={guardarRendicion}
                disabled={guardandoRendicion}
                className="rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
              >
                {guardandoRendicion ? 'Guardando…' : 'Anotar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Corregir lo cobrado (paso 54) */}
      {corrigiendo && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-10 w-full max-w-md rounded-lg bg-[var(--edr-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
              <h2 className="text-lg font-bold">¿Cuánto se cobró de verdad?</h2>
              <button
                onClick={() => setCorrigiendo(null)}
                className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 px-5 py-5">
              <p className="text-sm text-[var(--edr-muted)]">
                <span className="edr-mono">{corrigiendo.shipment?.tracking_code}</span> ·{' '}
                {corrigiendo.shipment ? nombreDelDestinatario(corrigiendo.shipment) : ''} ·{' '}
                {corrigiendo.shipment?.address_street}
              </p>

              <p className="text-sm">
                El repartidor cargó{' '}
                <strong className="edr-mono">{money(Number(corrigiendo.amount_collected ?? 0))}</strong>
                {Number(corrigiendo.shipment?.amount_to_collect) > 0 && (
                  <>
                    {' '}y el envío decía{' '}
                    <span className="edr-mono">
                      {money(Number(corrigiendo.shipment?.amount_to_collect))}
                    </span>
                  </>
                )}
                .
              </p>

              <div>
                <label className={labelCls}>Se cobró de verdad</label>
                <input
                  className={field}
                  inputMode="numeric"
                  value={montoReal}
                  onChange={(e) => setMontoReal(e.target.value)}
                  placeholder="36900"
                />
              </div>

              <div>
                <label className={labelCls}>Por qué (opcional)</label>
                <input
                  className={field}
                  value={notaCorreccion}
                  onChange={(e) => setNotaCorreccion(e.target.value)}
                  placeholder="pagó una parte, el resto lo arregla el comercio"
                />
              </div>

              {/* Qué va a pasar con la plata, antes de tocar nada. Corregir
                  mueve lo que el repartidor tiene que rendir. */}
              <p className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-xs text-[var(--edr-muted)]">
                Con esto cambia lo que tiene que rendir del día. El número que cargó el repartidor
                no se borra: queda guardado al lado, con tu nombre y la fecha.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
              <button
                onClick={() => setCorrigiendo(null)}
                className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
              >
                Cancelar
              </button>
              <button
                onClick={guardarCorreccion}
                disabled={guardandoCorreccion}
                className="rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
              >
                {guardandoCorreccion ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
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
