'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/driver/Toast';
import { countPending } from '@/lib/driver/db';
import {
  activarPush,
  desactivarPush,
  estadoPush,
  type EstadoPush,
} from '@/lib/driver/push';
import { useOnline } from '@/lib/driver/useOnline';
import { money, type Shipment } from '@/lib/format';
import ResolveDeliveryModal from '@/components/driver/ResolveDeliveryModal';
import {
  dayRange,
  logCash,
  summarizeLogs,
  today,
  weekRange,
  LOG_SELECT,
  type DaySummary,
  type DeliveryLog,
} from '@/lib/settlement';

const inputCls =
  'w-full rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-4 text-lg outline-none focus:border-[var(--edr-yellow)]';
const labelCls = 'mb-1 block text-sm font-bold uppercase tracking-wide text-[var(--edr-muted)]';

type Modo = 'dia' | 'semana';

/** Cierre de caja que cargó la oficina. */
interface Caja {
  cash_total: number | null;
  actual_amount: number | null;
  shipping_total: number | null;
  earnings: number | null;
  notes: string | null;
  settled_at: string | null;
  day?: string;
}

/** Suma de varios días, para el resumen semanal. */
interface CajaSemana {
  cobrado: number;
  rendido: number;
  envios: number;
  aCobrar: number;
  dias: Caja[];
}

function sumarSemana(filas: Caja[]): CajaSemana {
  return {
    cobrado: filas.reduce((a, c) => a + Number(c.cash_total ?? 0), 0),
    rendido: filas.reduce((a, c) => a + Number(c.actual_amount ?? 0), 0),
    envios: filas.reduce((a, c) => a + Number(c.shipping_total ?? 0), 0),
    aCobrar: filas.reduce((a, c) => a + Number(c.earnings ?? 0), 0),
    dias: filas,
  };
}

/** Trae los movimientos del período, sin tocar el estado de React. */
function fetchLogs(driverId: string, from: string, to: string) {
  return supabase
    .from('delivery_logs')
    .select(LOG_SELECT)
    .eq('driver_id', driverId)
    .gte('happened_at', from)
    .lte('happened_at', to)
    .order('happened_at');
}

export default function DriverProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  const [driver, setDriver] = useState<{ id: string; name: string; email: string } | null>(null);
  const [modo, setModo] = useState<Modo>('dia');
  const [day, setDay] = useState(today());
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [pending, setPending] = useState(0);
  const [caja, setCaja] = useState<Caja | null>(null);
  const [semana, setSemana] = useState<CajaSemana | null>(null);
  /** Qué lista está abierta al tocar los cuadros de arriba. */
  const [lista, setLista] = useState<'entregados' | 'fallidos' | null>(null);
  /** Envío que se está reabriendo para marcarlo como entregado. */
  const [corrigiendo, setCorrigiendo] = useState<Shipment | null>(null);
  /** Se incrementa para forzar que el resumen se vuelva a pedir. */
  const [refresco, setRefresco] = useState(0);
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [pushOcupado, setPushOcupado] = useState(false);

  const [abrirClave, setAbrirClave] = useState(false);
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [saving, setSaving] = useState(false);

  // --- sesión ------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      setDriver({ id: user.id, name: profile?.full_name ?? '', email: user.email ?? '' });
    });
  }, [router]);

  // --- resumen -----------------------------------------------------------
  // Sale de `delivery_logs`, la misma tabla con la que el admin liquida: así lo
  // que el chofer ve que tiene que rendir es exactamente lo que le van a pedir.
  useEffect(() => {
    if (!driver) return;
    let cancelled = false;
    const rango = modo === 'dia' ? dayRange(day) : weekRange(day);

    fetchLogs(driver.id, rango.from, rango.to).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error('[perfil] no se pudo traer el resumen', error);
        setSummaryError(error.message);
        return;
      }
      setSummaryError('');
      setSummary(summarizeLogs((data ?? []) as unknown as DeliveryLog[]));
    });

    return () => {
      cancelled = true;
    };
  }, [driver, modo, day, refresco]);

  // Cierre de caja: de un día, o la suma de todos los días de la semana.
  useEffect(() => {
    if (!driver) return;
    let cancelled = false;
    const campos = 'day, cash_total, actual_amount, shipping_total, earnings, notes, settled_at';

    if (modo === 'dia') {
      supabase
        .from('settlements')
        .select(campos)
        .eq('driver_id', driver.id)
        .eq('day', day)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          setCaja((data ?? null) as Caja | null);
          setSemana(null);
        });
    } else {
      const { desde, hasta } = weekRange(day);
      supabase
        .from('settlements')
        .select(campos)
        .eq('driver_id', driver.id)
        .gte('day', desde)
        .lte('day', hasta)
        .order('day')
        .then(({ data }) => {
          if (cancelled) return;
          const filas = (data ?? []) as unknown as Caja[];
          setSemana(filas.length ? sumarSemana(filas) : null);
          setCaja(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [driver, modo, day]);

  /**
   * Abre el formulario de entrega para un envío que se había cerrado como no
   * entregado. Sólo se ofrece el mismo día: corregir algo de ayer descuadra un
   * cierre de caja que ya puede estar liquidado.
   */
  async function corregir(shipmentId: number) {
    const { data, error } = await supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .maybeSingle();

    if (error || !data) {
      toast('No se pudo abrir ese envío.', 'error');
      return;
    }
    setCorrigiendo(data as Shipment);
  }

  const refreshPending = useCallback(() => {
    countPending().then(setPending);
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  // Estado de las notificaciones de ESTE celular.
  useEffect(() => {
    let cancelado = false;
    estadoPush().then((e) => {
      if (!cancelado) setPush(e);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  async function alternarPush() {
    if (!driver) return;
    setPushOcupado(true);
    try {
      const nuevo = push === 'activo' ? await desactivarPush() : await activarPush(driver.id);
      setPush(nuevo);
      if (nuevo === 'activo') toast('Listo, vas a recibir avisos en este celular.', 'ok');
      else if (nuevo === 'bloqueado')
        toast('Bloqueaste las notificaciones. Habilitalas en los permisos del sitio.', 'error');
    } finally {
      setPushOcupado(false);
    }
  }

  // --- contraseña --------------------------------------------------------
  async function changePassword() {
    if (pass1.length < 8) return toast('La contraseña nueva tiene que tener 8 o más.', 'error');
    if (pass1 !== pass2) return toast('Las dos contraseñas no coinciden.', 'error');
    if (!online) return toast('Para cambiar la contraseña hace falta internet.', 'error');

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pass1 });
    setSaving(false);

    if (error) {
      console.error('[perfil] updateUser falló', error);
      toast(error.message, 'error');
      return;
    }

    setPass1('');
    setPass2('');
    setAbrirClave(false);
    toast('Listo, contraseña cambiada.', 'ok');
  }

  const titulo =
    modo === 'dia'
      ? day === today()
        ? 'Hoy'
        : day.split('-').reverse().join('/')
      : `Semana del ${weekRange(day).desde.split('-').reverse().join('/')}`;

  return (
    <div className="min-h-dvh pb-10">
      <header className="flex items-center justify-between bg-[var(--edr-surface-2)] px-4 py-3 text-white">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black leading-tight">{driver?.name || 'Mi perfil'}</h1>
          <p className="truncate text-xs opacity-75">{driver?.email}</p>
        </div>
        <Link
          href="/driver/dashboard"
          className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold"
        >
          Hoja de ruta
        </Link>
      </header>

      <main className="space-y-5 px-4 py-4">
        {/* ---------- Período ---------- */}
        <section className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(['dia', 'semana'] as Modo[]).map((m) => (
              <button
                key={m}
                onClick={() => setModo(m)}
                className={`rounded-xl px-4 py-3 text-base font-black ${
                  modo === m
                    ? 'bg-[var(--edr-yellow)] text-black'
                    : 'border-2 border-[var(--edr-border)] text-[var(--edr-muted)]'
                }`}
              >
                {m === 'dia' ? 'Por día' : 'Semana'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <input
              type="date"
              value={day}
              max={today()}
              onChange={(e) => setDay(e.target.value)}
              className="flex-1 rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-3 text-base"
            />
            <button
              onClick={() => setDay(today())}
              className="rounded-xl border-2 border-[var(--edr-border)] px-4 py-3 text-base font-bold"
            >
              Hoy
            </button>
          </div>
        </section>

        {/* ---------- Resumen ---------- */}
        <section className="rounded-2xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-4">
          <h2 className="text-lg font-black">{titulo}</h2>

          {summaryError ? (
            <p className="mt-2 rounded-lg bg-red-600 px-3 py-2 text-center text-sm font-bold text-white">
              {summaryError}
            </p>
          ) : !summary ? (
            <p className="py-4 text-center text-sm font-semibold text-[var(--edr-muted)]">
              {online ? 'Calculando…' : 'Sin señal: no se puede calcular el resumen.'}
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                <Stat
                  label="Entregados"
                  value={String(summary.delivered.length)}
                  tone="ok"
                  onClick={() => setLista(lista === 'entregados' ? null : 'entregados')}
                  activo={lista === 'entregados'}
                />
                <Stat
                  label="No entregados"
                  value={String(summary.failed.length)}
                  tone="warn"
                  onClick={() => setLista(lista === 'fallidos' ? null : 'fallidos')}
                  activo={lista === 'fallidos'}
                />
              </div>

              {lista && (
                <ul className="mt-3 space-y-2">
                  {(lista === 'entregados' ? summary.delivered : summary.failed).map((l) => {
                    const hoy = l.happened_at.slice(0, 10) === today();
                    return (
                      <li
                        key={l.id}
                        className="rounded-xl border border-[var(--edr-border)] px-3 py-2 text-sm"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-bold">{l.shipment?.address_street ?? '—'}</span>
                          <span className="edr-mono shrink-0 text-xs text-[var(--edr-muted)]">
                            {new Date(l.happened_at).toLocaleTimeString('es-AR', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div className="text-xs text-[var(--edr-muted)]">
                          {l.shipment?.recipient_name}
                          {l.failure_reason ? ` · ${l.failure_reason.replace(/_/g, ' ')}` : ''}
                          {logCash(l) > 0 ? ` · ${money(logCash(l))}` : ''}
                        </div>

                        {lista === 'fallidos' && hoy && l.shipment && (
                          <button
                            onClick={() => corregir(l.shipment!.id)}
                            className="mt-2 w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-black text-white"
                          >
                            ✅ En realidad lo entregué
                          </button>
                        )}
                      </li>
                    );
                  })}

                  {(lista === 'entregados' ? summary.delivered : summary.failed).length === 0 && (
                    <li className="py-3 text-center text-sm text-[var(--edr-muted)]">
                      No hay envíos en esta lista.
                    </li>
                  )}
                </ul>
              )}

              <div className="mt-4 rounded-xl border-4 border-black bg-[var(--edr-yellow)] px-4 py-4 text-center text-black">
                <div className="text-sm font-black uppercase tracking-widest">Tenés que rendir</div>
                <div className="edr-mono text-5xl font-black leading-none">
                  {money(summary.cashTotal)}
                </div>
                <div className="mt-1 text-xs font-bold">efectivo cobrado</div>
              </div>

              <dl className="mt-3 space-y-1 text-base">
                <Line label="Cobrado en la puerta" value={money(summary.cashFromDeliveries)} />
                <Line label="Cobrado al retirar" value={money(summary.cashFromPickups)} />
              </dl>

              {/* ---------- Valor de los envíos ---------- */}
              <div className="mt-4 rounded-xl border-2 border-[var(--edr-border)] px-4 py-3">
                <div className="text-sm font-black uppercase tracking-wide text-[var(--edr-muted)]">
                  Valor de los envíos hechos
                </div>
                <div className="edr-mono text-3xl font-black">{money(summary.shippingTotal)}</div>
                <p className="mt-1 text-xs font-semibold text-[var(--edr-muted)]">
                  Sin descontar comisión. Lo ajusta la oficina en el cierre de caja.
                </p>
                {summary.shippingMissing > 0 && (
                  <p className="mt-2 rounded bg-[var(--edr-yellow)] px-2 py-1 text-center text-xs font-black text-black">
                    {summary.shippingMissing} envío(s) sin valor cargado: cuentan $0 y se completan
                    después.
                  </p>
                )}
              </div>

              {modo === 'dia' && caja && (
                <div className="mt-4 rounded-xl border-2 border-[var(--edr-yellow)] px-4 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-black uppercase tracking-wide">
                      Cierre de caja
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                        caja.settled_at ? 'bg-emerald-600 text-white' : 'bg-amber-400 text-black'
                      }`}
                    >
                      {caja.settled_at ? 'Liquidado' : 'Borrador'}
                    </span>
                  </div>

                  <dl className="space-y-1 text-base">
                    <Line label="Efectivo cobrado" value={money(summary.cashTotal)} />
                    <Line
                      label="Efectivo rendido / pagado"
                      value={money(Number(caja.actual_amount ?? 0))}
                    />
                    <Line
                      label="Envíos totales (sin comisión)"
                      value={money(Number(caja.shipping_total ?? summary.shippingTotal))}
                    />
                    <Line
                      label="Envíos a cobrar (comisión descontada)"
                      value={money(Number(caja.earnings ?? 0))}
                    />
                  </dl>

                  {(() => {
                    // Lo que cobró menos lo que ya entregó menos lo que se le debe.
                    // Positivo = todavía tiene plata de la empresa; negativo = le deben.
                    const saldo =
                      summary.cashTotal -
                      Number(caja.actual_amount ?? 0) -
                      Number(caja.earnings ?? 0);
                    const debe = saldo >= 0;
                    return (
                      <div
                        className={`mt-3 rounded-lg px-3 py-3 text-center ${
                          debe ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <div className="text-[11px] font-black uppercase tracking-widest">
                          {debe ? 'Total a rendir' : 'Total a cobrar'}
                        </div>
                        <div className="edr-mono text-3xl font-black leading-none">
                          {money(Math.abs(saldo))}
                        </div>
                      </div>
                    );
                  })()}

                  {caja.notes && (
                    <p className="mt-2 text-sm text-[var(--edr-muted)]">Nota: {caja.notes}</p>
                  )}
                </div>
              )}

              {modo === 'semana' && semana && (
                <div className="mt-4 rounded-xl border-2 border-[var(--edr-yellow)] px-4 py-3">
                  <div className="mb-2 text-sm font-black uppercase tracking-wide">
                    Cierre de la semana · {semana.dias.length} día(s) liquidado(s)
                  </div>

                  <dl className="space-y-1 text-base">
                    <Line label="Efectivo cobrado" value={money(semana.cobrado)} />
                    <Line label="Efectivo rendido / pagado" value={money(semana.rendido)} />
                    <Line label="Envíos totales (sin comisión)" value={money(semana.envios)} />
                    <Line label="Envíos a cobrar (comisión descontada)" value={money(semana.aCobrar)} />
                  </dl>

                  {(() => {
                    const saldo = semana.cobrado - semana.rendido - semana.aCobrar;
                    const debe = saldo >= 0;
                    return (
                      <div
                        className={`mt-3 rounded-lg px-3 py-3 text-center ${
                          debe ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                        }`}
                      >
                        <div className="text-[11px] font-black uppercase tracking-widest">
                          {debe ? 'Total a rendir' : 'Total a cobrar'}
                        </div>
                        <div className="edr-mono text-3xl font-black leading-none">
                          {money(Math.abs(saldo))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Detalle día por día, para poder revisar de dónde sale el total. */}
                  <ul className="mt-3 space-y-1 text-sm">
                    {semana.dias.map((d) => {
                      const saldoDia =
                        Number(d.cash_total ?? 0) -
                        Number(d.actual_amount ?? 0) -
                        Number(d.earnings ?? 0);
                      return (
                        <li
                          key={d.day}
                          className="flex items-center justify-between border-b border-[var(--edr-border)] pb-1"
                        >
                          <span className="font-semibold">
                            {(d.day ?? '').split('-').reverse().slice(0, 2).join('/')}
                          </span>
                          <span
                            className={`edr-mono font-bold ${
                              saldoDia >= 0 ? 'text-red-400' : 'text-emerald-400'
                            }`}
                          >
                            {money(Math.abs(saldoDia))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {modo === 'semana' && !semana && (
                <p className="mt-3 rounded-lg border border-[var(--edr-border)] px-3 py-2 text-center text-xs font-semibold text-[var(--edr-muted)]">
                  Todavía no hay ningún día liquidado en esta semana.
                </p>
              )}

              {modo === 'dia' && !caja && (
                <p className="mt-3 rounded-lg border border-[var(--edr-border)] px-3 py-2 text-center text-xs font-semibold text-[var(--edr-muted)]">
                  La oficina todavía no cargó el cierre de caja de este día.
                </p>
              )}

              {pending > 0 && (
                <p className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-center text-sm font-black text-black">
                  Ojo: {pending} entrega(s) todavía no llegaron al sistema. Este resumen las suma
                  cuando se envíen.
                </p>
              )}
            </>
          )}
        </section>

        {/* ---------- Notificaciones ---------- */}
        <section className="rounded-2xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <h2 className="text-lg font-black">Notificaciones</h2>
          <p className="mt-1 text-sm text-[var(--edr-muted)]">
            Te avisamos cuando la oficina te asigna un envío a mano y cuando te cierran la caja
            del día.
          </p>

          {push === 'no-soportado' ? (
            <p className="mt-3 rounded-lg border border-[var(--edr-border)] px-3 py-2 text-sm">
              Este navegador no soporta notificaciones. En iPhone hay que instalar la app en la
              pantalla de inicio primero.
            </p>
          ) : push === 'bloqueado' ? (
            <p className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">
              Están bloqueadas. Tocá el candado al lado de la dirección → Permisos del sitio →
              Notificaciones → Permitir.
            </p>
          ) : (
            <button
              onClick={alternarPush}
              disabled={pushOcupado || push === null}
              className={`mt-3 w-full rounded-xl px-6 py-5 text-lg font-black active:scale-[0.99] disabled:opacity-60 ${
                push === 'activo'
                  ? 'border-2 border-emerald-400 text-emerald-400'
                  : 'bg-[var(--edr-yellow)] text-black'
              }`}
            >
              {pushOcupado
                ? 'Un momento…'
                : push === 'activo'
                  ? '🔔 Activadas · tocá para desactivar'
                  : '🔔 Activar notificaciones'}
            </button>
          )}
        </section>

        {/* ---------- Contraseña ---------- */}
        <section className="rounded-2xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <button
            onClick={() => setAbrirClave((v) => !v)}
            className="flex w-full items-center justify-between text-lg font-black"
          >
            Cambiar contraseña
            <span className="text-2xl leading-none">{abrirClave ? '−' : '+'}</span>
          </button>

          {abrirClave && (
            <div className="mt-4 space-y-3">
              <div>
                <label className={labelCls}>Contraseña nueva</label>
                <input
                  type="password"
                  className={inputCls}
                  value={pass1}
                  onChange={(e) => setPass1(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className={labelCls}>Repetila</label>
                <input
                  type="password"
                  className={inputCls}
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <button
                onClick={changePassword}
                disabled={saving}
                className="w-full rounded-xl bg-[var(--edr-yellow)] px-6 py-5 text-lg font-black text-black active:scale-[0.99] disabled:opacity-60"
              >
                {saving ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </div>
          )}
        </section>

        <button
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/login');
          }}
          className="w-full rounded-xl border-2 border-[var(--edr-border)] px-6 py-4 text-lg font-black text-[var(--edr-muted)]"
        >
          Salir de la cuenta
        </button>
      </main>

      {corrigiendo && (
        <ResolveDeliveryModal
          shipment={corrigiendo}
          kind="entregado"
          onClose={() => setCorrigiendo(null)}
          onResolved={() => setCorrigiendo(null)}
          onSynced={() => {
            setCorrigiendo(null);
            // Vuelve a pedir el resumen para que el envío cambie de lista.
            setLista(null);
            setRefresco((n) => n + 1);
            refreshPending();
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  onClick,
  activo,
}: {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
  onClick?: () => void;
  activo?: boolean;
}) {
  const toneCls =
    tone === 'ok'
      ? 'bg-emerald-600 text-white'
      : tone === 'warn'
        ? 'bg-orange-500 text-white'
        : 'bg-[var(--edr-surface-2)]';
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-2 py-3 text-center ${toneCls} ${
        activo ? 'ring-4 ring-[var(--edr-yellow)]' : ''
      }`}
    >
      <div className="edr-mono text-3xl font-black leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase leading-tight">{label}</div>
      {onClick && <div className="mt-1 text-[10px] opacity-80">tocá para ver</div>}
    </button>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-[var(--edr-border)] pb-1">
      <dt className="text-[var(--edr-muted)]">{label}</dt>
      <dd className="edr-mono font-bold">{value}</dd>
    </div>
  );
}
