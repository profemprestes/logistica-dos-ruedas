'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/driver/Toast';
import { countPending } from '@/lib/driver/db';
import { useOnline } from '@/lib/driver/useOnline';
import { money } from '@/lib/format';
import {
  dayRange,
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

/** Cierre de caja que cargó la oficina para ese día. */
interface Caja {
  actual_amount: number | null;
  shipping_total: number | null;
  earnings: number | null;
  notes: string | null;
  settled_at: string | null;
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
  }, [driver, modo, day]);

  useEffect(() => {
    if (!driver || modo !== 'dia') {
      return;
    }
    let cancelled = false;

    supabase
      .from('settlements')
      .select('actual_amount, shipping_total, earnings, notes, settled_at')
      .eq('driver_id', driver.id)
      .eq('day', day)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setCaja((data ?? null) as Caja | null);
      });

    return () => {
      cancelled = true;
    };
  }, [driver, modo, day]);

  const refreshPending = useCallback(() => {
    countPending().then(setPending);
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

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
          <h1 className="truncate text-lg font-black leading-tight">{driver?.name || 'Mi día'}</h1>
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
                <Stat label="Entregados" value={String(summary.delivered.length)} tone="ok" />
                <Stat label="No entregados" value={String(summary.failed.length)} tone="warn" />
              </div>

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
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  const toneCls =
    tone === 'ok'
      ? 'bg-emerald-600 text-white'
      : tone === 'warn'
        ? 'bg-orange-500 text-white'
        : 'bg-[var(--edr-surface-2)]';
  return (
    <div className={`rounded-xl px-2 py-3 ${toneCls}`}>
      <div className="edr-mono text-3xl font-black leading-none">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase leading-tight">{label}</div>
    </div>
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
