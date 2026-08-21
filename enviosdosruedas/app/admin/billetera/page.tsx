'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { diaAR, money, nombreDelDestinatario } from '@/lib/format';
import { logCash, pagoDelEnvio } from '@/lib/settlement';
import {
  anotar,
  ARRANCA,
  borrarMovimiento,
  hoyEnCasa,
  NOMBRE_TIPO,
  porDia,
  traerBilleteras,
  type Billetera,
  type TipoMovimiento,
} from '@/lib/billetera';

/**
 * La billetera de cada repartidor.
 *
 * QUÉ PREGUNTA CONTESTA, y no la contestaba ninguna de las otras dos pantallas
 * de plata: ¿CUÁNTO ME DEBE CADA UNO AHORA? El cierre de caja es de un día;
 * "Caja y ganancia" es de un período. Un saldo no es de un período: es lo que
 * hay, hoy, y por eso acá no hay filtro de fechas.
 *
 * POR QUÉ HACÍA FALTA. Lo rendido vivía adentro del cierre de un día, y la
 * plata no se entrega por día: el repartidor junta lo de varias jornadas y un
 * martes deja un monto que cubre todo. El 12/08/2026 quedó escrito "cobró
 * $ 9.900, rindió $ 55.000" — cierto, pero pegado a un día al que no pertenece.
 *
 * LAS DOS PLATAS SE MUESTRAN SEPARADAS aunque el saldo las netee. Lo que él
 * cobró y todavía no entregó, y lo que le toca y todavía no cobró, son dos
 * conversaciones distintas: una es "traeme la plata" y la otra es "tomá lo
 * tuyo". Un solo número las esconde a las dos.
 */

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

interface Repartidor {
  id: string;
  full_name: string;
  active: boolean;
}

export default function BilleteraPage() {
  const ready = useAdminGuard();
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [cuentas, setCuentas] = useState<Map<string, Billetera>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);

  /** El cuadro de anotar: a quién y de qué tipo. */
  const [anotando, setAnotando] = useState<{ driver: Repartidor; tipo: TipoMovimiento } | null>(
    null,
  );
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoyEnCasa());
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('profiles')
      .select('id, full_name, active')
      .eq('role', 'repartidor')
      .order('full_name');

    if (e) {
      setError(e.message);
      setCargando(false);
      return;
    }

    const lista = (data ?? []) as Repartidor[];
    setRepartidores(lista);
    setCuentas(await traerBilleteras(lista.map((r) => r.id)));
    setCargando(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let vivo = true;
    const traer = async () => {
      await cargar();
      if (!vivo) return;
    };
    void traer();
    return () => {
      vivo = false;
    };
  }, [ready, cargar]);

  async function guardar() {
    if (!anotando) return;

    setGuardando(true);
    setError('');

    const r = await anotar({
      driverId: anotando.driver.id,
      fecha,
      tipo: anotando.tipo,
      monto: Number(monto),
      nota,
    });

    setGuardando(false);

    if (r.error) {
      setError(r.error);
      return;
    }

    setAnotando(null);
    setMonto('');
    setNota('');
    setCargando(true);
    await cargar();
  }

  async function borrar(id: number, texto: string) {
    if (!confirm(`¿Borrar ${texto}?\n\nEl saldo se recalcula al instante.`)) return;
    const r = await borrarMovimiento(id);
    if (r.error) {
      setError(r.error);
      return;
    }
    setCargando(true);
    await cargar();
  }

  function abrirCuadro(driver: Repartidor, tipo: TipoMovimiento, sugerido: number) {
    setAnotando({ driver, tipo });
    // Arranca con lo que falta: casi siempre entrega todo lo que debe, y
    // escribir el número de nuevo es una oportunidad de equivocarse.
    setMonto(sugerido > 0 ? String(sugerido) : '');
    setFecha(hoyEnCasa());
    setNota('');
  }

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  const conCuenta = repartidores
    .map((r) => ({ r, c: cuentas.get(r.id) }))
    .filter((x): x is { r: Repartidor; c: Billetera } => Boolean(x.c))
    // Primero el que más debe: es a quien hay que llamar.
    .sort((a, b) => b.c.debeRendir - a.c.debeRendir);

  /*
   * Los totales suman los saldos CON SIGNO, no sólo los positivos.
   *
   * Si uno rindió de más, esa plata pasó a ser nuestra deuda con él y tiene que
   * bajar el total que nos deben, no quedar afuera de la cuenta.
   */
  const totalDeben = conCuenta.reduce((acc, x) => acc + x.c.debeRendir, 0);
  const totalLesDebemos = conCuenta.reduce((acc, x) => acc + x.c.leDebemos, 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-black">Billetera</h1>
        <p className="text-xs text-[var(--edr-muted)]">
          Desde el {ARRANCA.split('-').reverse().join('/')} · sin filtro de fechas: es el saldo de
          hoy
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5">
        <Tarjeta label="Tienen que rendirte" valor={money(totalDeben)} tono="warn" />
        <Tarjeta label="Tenés que pagarles" valor={money(totalLesDebemos)} tono="ok" />
      </div>

      {cargando ? (
        <p className="py-12 text-center text-sm text-[var(--edr-muted)]">Haciendo las cuentas…</p>
      ) : conCuenta.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--edr-muted)]">
          No hay repartidores cargados.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {conCuenta.map(({ r, c }) => (
            <section
              key={r.id}
              className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)]"
            >
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-base font-black">
                    {r.full_name}
                    {!r.active && (
                      <span className="ml-2 rounded bg-[var(--edr-surface-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-muted)]">
                        inactivo
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--edr-muted)]">
                    cobró {money(c.cobrado)} · rindió {money(c.rendido)}
                  </div>
                </div>

                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <Pendiente
                    label="Debe rendir"
                    valor={c.debeRendir}
                    tono="warn"
                    onAnotar={() => abrirCuadro(r, 'rendicion', c.debeRendir)}
                    accion="Rindió"
                  />
                  <Pendiente
                    label="Le debemos"
                    valor={c.leDebemos}
                    tono="ok"
                    onAnotar={() => abrirCuadro(r, 'pago', c.leDebemos)}
                    accion="Le pagué"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--edr-border)] px-4 py-2">
                <button
                  onClick={() => setAbierto(abierto === r.id ? null : r.id)}
                  className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--edr-surface-2)]"
                >
                  {abierto === r.id ? 'Ocultar el detalle' : 'Ver el detalle'}
                </button>
                <button
                  onClick={() => abrirCuadro(r, 'ajuste', 0)}
                  className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-semibold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
                >
                  Ajuste
                </button>
                <Link
                  href={`/admin/billing?repartidor=${r.id}`}
                  className="ml-auto text-xs font-semibold text-[var(--edr-acento)] underline underline-offset-2"
                >
                  Cerrar un día suyo
                </Link>
              </div>

              {abierto === r.id && <Detalle cuenta={c} onBorrar={borrar} />}
            </section>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--edr-muted)]">
        <strong>Debe rendir</strong> es lo que cobró en la calle menos lo que ya entregó.{' '}
        <strong>Le debemos</strong> es lo que le toca por sus envíos menos lo que ya se le pagó. Van
        separados a propósito: una cosa es pedirle la plata y otra pagarle la suya.
      </p>

      {cuadro()}
    </main>
  );

  /* ------------------------------------------------------------- el cuadro */
  function cuadro() {
    if (!anotando) return null;

    const { driver, tipo } = anotando;
    const titulo =
      tipo === 'rendicion'
        ? `¿Cuánto te entregó ${driver.full_name}?`
        : tipo === 'pago'
          ? `¿Cuánto le pagaste a ${driver.full_name}?`
          : `Ajuste en la cuenta de ${driver.full_name}`;

    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
        <div className="my-10 w-full max-w-md rounded-lg bg-[var(--edr-surface)] shadow-xl">
          <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
            <h2 className="text-lg font-bold">{titulo}</h2>
            <button
              onClick={() => setAnotando(null)}
              className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
            >
              ×
            </button>
          </div>

          <div className="grid gap-3 px-5 py-5">
            <div>
              <label className={labelCls}>Cuánto</label>
              <input
                className={campo}
                inputMode="numeric"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                placeholder="50000"
              />
              {tipo === 'ajuste' && (
                <p className="mt-1 text-xs text-[var(--edr-muted)]">
                  En negativo si le baja lo que debe (por ejemplo, −2000).
                </p>
              )}
            </div>

            <div>
              <label className={labelCls}>Qué día</label>
              <input
                type="date"
                className={campo}
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
              <p className="mt-1 text-xs text-[var(--edr-muted)]">
                El día en que cambió de manos, no el de los envíos que cubre.
              </p>
            </div>

            <div>
              <label className={labelCls}>Nota (opcional)</label>
              <input
                className={campo}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="lo de la semana pasada"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
            <button
              onClick={() => setAnotando(null)}
              className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
            >
              Cancelar
            </button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Anotar'}
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function Tarjeta({ label, valor, tono }: { label: string; valor: string; tono: 'warn' | 'ok' }) {
  return (
    <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        {label}
      </div>
      <div
        className="edr-mono text-2xl font-black"
        style={{ color: tono === 'warn' ? 'var(--edr-rojo)' : 'var(--edr-verde)' }}
      >
        {valor}
      </div>
    </div>
  );
}

/**
 * Un pendiente con su botón al lado.
 *
 * EN NEGATIVO CAMBIA DE CARA, y no se esconde. Si entregó más plata de la que
 * cobró —pasa cuando rinde un número redondo, o cuando cubre lo de otra
 * semana— el pendiente da negativo. Mostrando sólo `Math.max(0, …)` esa plata
 * desaparecía de la pantalla, y es plata que ahora le debemos a él.
 */
function Pendiente({
  label,
  valor,
  tono,
  accion,
  onAnotar,
}: {
  label: string;
  valor: number;
  tono: 'warn' | 'ok';
  accion: string;
  onAnotar: () => void;
}) {
  const hay = valor > 0;
  const deMas = valor < 0;

  return (
    <div className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-right">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        {deMas ? (tono === 'warn' ? 'Rindió de más' : 'Le pagamos de más') : label}
      </div>
      <div
        className="edr-mono text-lg font-black leading-tight"
        style={{
          color: hay
            ? tono === 'warn'
              ? 'var(--edr-rojo)'
              : 'var(--edr-verde)'
            : deMas
              ? tono === 'warn'
                ? 'var(--edr-verde)'
                : 'var(--edr-rojo)'
              : undefined,
        }}
      >
        {valor === 0 ? '—' : money(Math.abs(valor))}
      </div>
      <button
        onClick={onAnotar}
        className="mt-1 rounded bg-[var(--edr-yellow)] px-2.5 py-1 text-[11px] font-black text-[var(--edr-blue)] hover:brightness-95"
      >
        {accion}
      </button>
    </div>
  );
}

/**
 * El detalle de la cuenta: primero lo anotado, después la calle.
 *
 * Lo anotado va arriba porque es lo que se discute. Lo de la calle está para
 * poder contestar "¿de dónde salen esos $ 78.600?" sin cambiar de pantalla.
 */
function Detalle({
  cuenta,
  onBorrar,
}: {
  cuenta: Billetera;
  onBorrar: (id: number, texto: string) => void;
}) {
  const conPlata = cuenta.logs.filter((l) => logCash(l) > 0 || l.event === 'entregado');

  return (
    <div className="border-t border-[var(--edr-border)] px-4 py-3">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        Lo anotado
      </h3>

      {cuenta.movimientos.length === 0 ? (
        <p className="text-sm text-[var(--edr-muted)]">
          Todavía no hay ninguna entrega de plata anotada.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {cuenta.movimientos.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded bg-[var(--edr-surface-2)] px-3 py-1.5 text-sm"
            >
              <span className="edr-mono text-xs text-[var(--edr-muted)]">
                {m.fecha.split('-').reverse().slice(0, 2).join('/')}
              </span>
              <span className="font-semibold">{NOMBRE_TIPO[m.tipo]}</span>
              {m.nota && <span className="truncate text-xs text-[var(--edr-muted)]">{m.nota}</span>}
              <span className="edr-mono ml-auto font-bold">{money(Number(m.monto))}</span>
              <button
                onClick={() =>
                  onBorrar(
                    m.id,
                    `${NOMBRE_TIPO[m.tipo].toLowerCase()} ${money(Number(m.monto))} del ${m.fecha}`,
                  )
                }
                title="Borrar este movimiento"
                className="rounded px-1.5 text-xs text-[var(--edr-muted)] hover:bg-[var(--edr-surface)]"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {/*
        DÍA POR DÍA, con el saldo arrastrándose.

        Es la vista que pidió el repartidor y también sirve del lado de la
        oficina: contesta "¿desde cuándo viene debiendo?", que es distinto de
        "¿cuánto debe?". Un saldo grande de un solo día es una jornada buena; el
        mismo saldo arrastrado tres semanas es otra cosa.
      */}
      <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        Día por día
      </h3>

      <div className="overflow-x-auto rounded border border-[var(--edr-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--edr-surface-2)] text-left text-[10px] uppercase text-[var(--edr-muted)]">
            <tr>
              <th className="px-2 py-1">Día</th>
              <th className="px-2 py-1 text-right">Entregas</th>
              <th className="px-2 py-1 text-right">Cobró</th>
              <th className="px-2 py-1 text-right">Le tocó</th>
              <th className="px-2 py-1 text-right">Rindió</th>
              <th className="px-2 py-1 text-right">Le pagamos</th>
              <th className="px-2 py-1 text-right">Debía al cierre</th>
            </tr>
          </thead>
          <tbody>
            {porDia(cuenta).map((d) => (
              <tr key={d.fecha} className="border-t border-[var(--edr-border)]">
                <td className="edr-mono px-2 py-1">
                  {d.fecha.split('-').reverse().slice(0, 2).join('/')}
                </td>
                <td className="edr-mono px-2 py-1 text-right">{d.entregas || '—'}</td>
                <td className="edr-mono px-2 py-1 text-right">
                  {d.cobrado > 0 ? money(d.cobrado) : '—'}
                </td>
                <td className="edr-mono px-2 py-1 text-right text-[var(--edr-acento)]">
                  {d.ganado > 0 ? money(d.ganado) : '—'}
                </td>
                <td className="edr-mono px-2 py-1 text-right font-bold">
                  {d.rendido > 0 ? money(d.rendido) : '—'}
                </td>
                <td className="edr-mono px-2 py-1 text-right font-bold">
                  {d.pagado > 0 ? money(d.pagado) : '—'}
                </td>
                <td
                  className="edr-mono px-2 py-1 text-right font-black"
                  style={{
                    color: d.debeAcumulado > 0 ? 'var(--edr-rojo)' : 'var(--edr-verde)',
                  }}
                >
                  {d.debeAcumulado < 0 ? '+' : ''}
                  {money(Math.abs(d.debeAcumulado))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        De dónde sale · {conPlata.length} movimiento(s) en la calle
      </h3>

      <div className="max-h-72 overflow-y-auto rounded border border-[var(--edr-border)]">
        <table className="w-full text-xs">
          <tbody>
            {conPlata.map((l) => (
              <tr key={l.id} className="border-b border-[var(--edr-border)] last:border-0">
                {/*
                  La fecha va con `diaAR` y no cortando el texto del ISO.
                  
                  Los movimientos se guardan en UTC, tres horas adelante: una
                  entrega de las diez de la noche queda escrita como del día
                  siguiente. Cortando el texto, esa entrega aparecía un día
                  corrido de todo el resto de la pantalla — y en una lista de
                  plata, una fecha que no coincide es lo primero que hace dudar
                  del total.
                */}
                <td className="edr-mono px-2 py-1 text-[var(--edr-muted)]">
                  {diaAR(l.happened_at)}
                </td>
                <td className="edr-mono px-2 py-1">{l.shipment?.tracking_code ?? '—'}</td>
                <td className="px-2 py-1">
                  {l.shipment ? nombreDelDestinatario(l.shipment) : '—'}
                </td>
                <td className="edr-mono px-2 py-1 text-right">
                  {logCash(l) > 0 ? money(logCash(l)) : '—'}
                </td>
                <td className="edr-mono px-2 py-1 text-right text-[var(--edr-acento)]">
                  {l.event === 'entregado' ? `+${money(pagoDelEnvio(l))}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[11px] text-[var(--edr-muted)]">
        La columna del medio es lo que cobró en la puerta; la de la derecha, lo que le toca a él por
        ese envío.
      </p>
    </div>
  );
}
