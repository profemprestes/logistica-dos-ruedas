'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  customRange,
  dayShift,
  LOG_SELECT,
  pagoDelEnvio,
  summarizeLogs,
  today,
  weekRange,
  type DaySummary,
  type DeliveryLog,
} from '@/lib/settlement';
import { money } from '@/lib/format';

/**
 * La caja del día del repartidor.
 *
 * POR QUÉ TIENE PANTALLA PROPIA. Antes esto vivía adentro del perfil, mezclado
 * con el cambio de contraseña y las notificaciones. Pero es lo que mira todos
 * los días a las siete de la tarde, antes de pasar por la oficina, y lo que
 * discute si el número no le cierra. Merece estar a un toque, no a tres.
 *
 * LOS NOMBRES SON LOS MISMOS QUE USA LA OFICINA en el cierre de caja. Si acá
 * dijera "efectivo" y allá "cobrado", cada diferencia de redondeo sería una
 * discusión sobre qué significa cada palabra en vez de sobre la plata.
 *
 * Y ES SÓLO DE LECTURA a propósito: el cierre lo hace siempre el admin. Acá se
 * ve para poder rendir sabiendo cuánto, no para cerrarlo.
 */

const PERIODOS = [
  { label: 'HOY', dias: 0 },
  { label: 'AYER', dias: -1 },
  { label: 'SEMANA', dias: null },
] as const;

/** El cierre que ya hizo la oficina, si lo hizo. */
interface Cierre {
  cash_total: number;
  actual_amount: number;
  earnings: number | null;
  settled_at: string | null;
}

export default function CajaPage() {
  const [driverId, setDriverId] = useState('');
  const [periodo, setPeriodo] = useState<number | null>(0);
  const [resumen, setResumen] = useState<DaySummary | null>(null);
  const [cierre, setCierre] = useState<Cierre | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setDriverId(data.user?.id ?? ''));
  }, []);

  const unDia = periodo !== null;
  const dia = unDia ? dayShift(today(), periodo) : today();

  useEffect(() => {
    if (!driverId) return;
    let vivo = true;

    const { desde, hasta } = unDia
      ? { desde: dia, hasta: dia }
      : { desde: weekRange(today()).desde, hasta: weekRange(today()).hasta };

    const { from, to } = customRange(desde, hasta);

    supabase
      .from('delivery_logs')
      .select(LOG_SELECT)
      .eq('driver_id', driverId)
      .gte('happened_at', from)
      .lte('happened_at', to)
      .order('happened_at')
      .then(({ data, error: dbError }) => {
        if (!vivo) return;
        if (dbError) {
          setError('No se pudo traer la caja. Probá de nuevo cuando tengas señal.');
          return;
        }
        setError('');
        setResumen(summarizeLogs((data ?? []) as unknown as DeliveryLog[]));
      });

    /*
     * El cierre de la oficina sólo tiene sentido para un día suelto.
     *
     * En la semana se pide igual y se descarta el resultado, en vez de apagar
     * el estado con un `setCierre(null)` suelto: hacerlo en el cuerpo del
     * efecto dispara renders en cascada, y el compilador de React lo marca.
     */
    supabase
      .from('settlements')
      .select('cash_total, actual_amount, earnings, settled_at')
      .eq('driver_id', driverId)
      .eq('day', dia)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo) setCierre(unDia ? ((data ?? null) as Cierre | null) : null);
      });

    return () => {
      vivo = false;
    };
  }, [driverId, dia, unDia]);

  /**
   * Lo que le queda a favor, según la oficina.
   *
   * Sale del cierre y no de una cuenta propia: la comisión y los ajustes los
   * decide el admin, y un número calculado acá con otra regla sería justamente
   * el que arma la discusión.
   */
  /** El cierre ya hecho trae el número definitivo: ahí deja de ser estimado. */
  const cierreConGanancia = cierre?.earnings !== null && cierre?.earnings !== undefined;

  const saldo = cierre
    ? Number(cierre.cash_total) - Number(cierre.actual_amount) - Number(cierre.earnings ?? 0)
    : null;

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      <h1 className="font-anton text-[26px] uppercase leading-none tracking-[-.02em] text-white">
        Caja del día
      </h1>

      <div className="flex gap-2">
        {PERIODOS.map((p) => {
          const activo = p.dias === periodo;
          return (
            <button
              key={p.label}
              onClick={() => {
                // Se limpia acá, en el toque, y no adentro del efecto.
                setResumen(null);
                setPeriodo(p.dias);
              }}
              className={`min-h-11 flex-1 rounded-full border font-bebas text-base tracking-[.06em] transition active:scale-95 ${
                activo
                  ? 'border-[var(--edr-yellow)] bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                  : 'border-white/20 text-[var(--edr-muted)]'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="rounded-2xl bg-[var(--edr-rojo)] px-4 py-3 text-base font-bold text-white">
          {error}
        </p>
      )}

      {!resumen && !error && (
        <p className="py-10 text-center text-base font-semibold text-[var(--edr-muted)]">
          Sacando la cuenta…
        </p>
      )}

      {resumen && (
        <>
          <div className="rounded-3xl bg-[var(--edr-yellow)] p-5 text-[var(--edr-blue)] shadow-[var(--edr-sombra)]">
            <div className="font-bebas text-[17px] tracking-[.1em]">TENÉS QUE RENDIR</div>
            <div className="edr-mono text-[56px] font-extrabold leading-[.95] tracking-[-.04em]">
              {money(resumen.cashTotal)}
            </div>
            <div className="text-[13px] font-semibold opacity-80">
              efectivo cobrado {unDia ? 'en el día' : 'en la semana'}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Tile
              Icono={CheckCircle2}
              color="text-emerald-400"
              valor={resumen.delivered.length}
              label="ENTREGADOS"
            />
            <Tile
              Icono={XCircle}
              color="text-red-400"
              valor={resumen.failed.length}
              label="NO ENTREGADOS"
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-[var(--edr-blue)] p-4">
            <div className="font-bebas text-[15px] tracking-[.08em] text-[var(--edr-yellow)]">
              DE DÓNDE SALE
            </div>
            <dl className="mt-2.5 space-y-2">
              <Renglon label="Cobrado en la puerta" valor={resumen.cashFromDeliveries} />
              <Renglon label="Cobrado al retirar" valor={resumen.cashFromPickups} />
              <Renglon label="Valor de los envíos hechos" valor={resumen.shippingTotal} apagado />
            </dl>
            <p className="mt-2.5 text-xs text-[var(--edr-muted)]">
              El valor de los envíos va sin descontar comisión: eso lo ajusta la oficina al cerrar
              el día.
            </p>
            {resumen.shippingMissing > 0 && (
              <p className="mt-2 rounded-xl bg-white/[.08] px-3 py-2 text-xs font-semibold text-[var(--edr-blue-soft)]">
                {resumen.shippingMissing} envío(s) sin valor cargado: cuentan $0 hasta que la
                oficina los complete.
              </p>
            )}
          </div>

          {/*
            LO QUE LE TOCA, ENVÍO POR ENVÍO.

            Es la misma cuenta que hace la oficina —sale de `pagoDelEnvio`, la
            función que también suma el total del cierre— así que la lista y el
            total no se pueden separar. Pero es una ESTIMACIÓN y hay que decirlo
            fuerte: la oficina puede ajustar valores, cargar un envío que quedó
            sin precio o corregir algo, y el número final es el del cierre. Un
            número que después cambia sin aviso es peor que no mostrarlo.
          */}
          <div className="rounded-3xl border border-white/10 bg-[var(--edr-blue)] p-4">
            <div className="font-bebas text-[15px] tracking-[.08em] text-[var(--edr-yellow)]">
              LO QUE TE TOCA {cierreConGanancia ? '' : '(ESTIMADO)'}
            </div>

            <div className="edr-mono text-[38px] font-extrabold leading-none tracking-[-.03em] text-white">
              {money(cierreConGanancia ? Number(cierre!.earnings) : resumen.driverEarnings)}
            </div>

            <p className="mt-1 text-xs text-[var(--edr-muted)]">
              {cierreConGanancia
                ? 'Confirmado por la oficina al cerrar el día.'
                : 'Es una cuenta del sistema y PUEDE CAMBIAR: el número final lo confirma la oficina al cerrar el día.'}
            </p>

            {resumen.countShippy > 0 && (
              <p className="mt-1 text-xs text-[var(--edr-muted)]">
                {resumen.countShippy} de Shippy van enteros, sin comisión.
              </p>
            )}

            <ul className="mt-3 flex flex-col gap-1.5">
              {resumen.delivered.map((l) => {
                const valor = Number(l.shipment?.shipping_fee ?? 0);
                const paga = pagoDelEnvio(l);
                // Sin valor cargado no se inventa nada: se dice que falta.
                const sinCargar = valor === 0 && paga === 0;

                return (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 rounded-2xl bg-black/20 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14px] font-semibold text-white">
                        {l.shipment?.address_street ?? 'Sin dirección'}
                      </div>
                      <div className="truncate text-[11.5px] text-[var(--edr-muted)]">
                        {l.shipment?.client_name_raw ?? ''}
                        {valor > 0 ? ` · envío ${money(valor)}` : ''}
                      </div>
                    </div>

                    {sinCargar ? (
                      <span className="shrink-0 text-right text-[11px] font-semibold leading-tight text-[var(--edr-naranja-claro)]">
                        lo carga
                        <br />
                        la oficina
                      </span>
                    ) : (
                      <span className="edr-mono shrink-0 text-[15px] font-extrabold text-[var(--edr-yellow)]">
                        {money(paga)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {unDia && (
            <div className="rounded-3xl bg-[var(--edr-dark)] p-4">
              {cierre ? (
                <>
                  <div className="font-bebas text-[15px] tracking-[.08em] text-[var(--edr-muted)]">
                    {saldo !== null && saldo >= 0 ? 'TE FALTA RENDIR' : 'TE QUEDA A FAVOR'}
                  </div>
                  <div
                    className={`edr-mono text-[32px] font-extrabold leading-tight ${
                      saldo !== null && saldo >= 0
                        ? 'text-[var(--edr-yellow)]'
                        : 'text-emerald-400'
                    }`}
                  >
                    {money(Math.abs(saldo ?? 0))}
                  </div>
                  <p className="text-xs text-[var(--edr-muted)]">
                    Según el cierre que hizo la oficina.
                  </p>
                </>
              ) : (
                <p className="text-sm font-semibold text-[var(--edr-muted)]">
                  La oficina todavía no cerró este día. Cuando lo cierre, acá vas a ver cuánto te
                  queda a favor.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Tile({
  Icono,
  color,
  valor,
  label,
}: {
  Icono: typeof CheckCircle2;
  color: string;
  valor: number;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-4">
      <Icono size={22} strokeWidth={2} className={color} />
      <div className="edr-mono mt-1 text-3xl font-extrabold text-white">{valor}</div>
      <div className="font-bebas text-[13px] tracking-[.08em] text-[var(--edr-muted)]">{label}</div>
    </div>
  );
}

function Renglon({
  label,
  valor,
  apagado = false,
}: {
  label: string;
  valor: number;
  apagado?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-sm ${apagado ? 'text-[var(--edr-muted)]' : 'text-white'}`}>{label}</dt>
      <dd
        className={`edr-mono text-lg font-bold ${
          apagado ? 'text-[var(--edr-muted)]' : 'text-white'
        }`}
      >
        {money(valor)}
      </dd>
    </div>
  );
}
