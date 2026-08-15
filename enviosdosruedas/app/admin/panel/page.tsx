'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Bike,
  CalendarClock,
  CheckCircle2,
  MapPin,
  UserCheck,
} from 'lucide-react';
import { useAdminGuard } from '@/lib/adminGuard';
import { money } from '@/lib/format';
import { useDatosDelDia, type Repartidor } from '@/components/admin/DatosDelDia';
import type { Atraso } from '@/lib/admin/atrasos';

/**
 * El Panel del día: qué está pasando ahora, sin buscar nada.
 *
 * La tabla de envíos contesta "¿dónde está el EDR-tanto?". Esta pantalla
 * contesta otra pregunta, la que se hace la oficina cada media hora sin
 * dársela: "¿hay algo que se me esté yendo?". Son dos preguntas distintas y
 * por eso son dos pantallas: mezcladas, la segunda no se hace nunca, porque
 * mirar cincuenta filas para descubrir que seis no tienen repartidor es un
 * trabajo que nadie hace de puro voluntarioso.
 *
 * Las cuatro reglas de atraso están en `lib/admin/atrasos.ts`.
 */

const TONO = {
  rojo: 'var(--edr-rojo)',
  naranja: 'var(--edr-naranja)',
} as const;

const ICONO_ACCION = {
  sin_asignar: UserCheck,
  sin_retirar: MapPin,
  demorado: MapPin,
  sin_reprogramar: CalendarClock,
} as const;

const panel = 'rounded-3xl border border-[var(--edr-hairline)] bg-[var(--edr-panel)]';
const titulo = 'font-anton text-[19px] uppercase tracking-[-.01em] text-[var(--edr-text)]';

export default function PanelDelDiaPage() {
  const ready = useAdminGuard();
  const { cargando, deHoy, atrasos, repartidores, aCobrar, entregados } = useDatosDelDia();

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-text-3)]">Cargando…</div>;

  const enCalle = deHoy.filter((s) => s.status === 'retirado' || s.status === 'en_camino').length;
  const sinSalir = deHoy.filter(
    (s) => s.status === 'creado' || s.status === 'pendiente_retiro',
  ).length;

  const tiles = [
    { label: 'ENVÍOS', valor: deHoy.length, color: 'var(--edr-text)', nota: 'programados hoy' },
    { label: 'EN LA CALLE', valor: enCalle, color: 'var(--edr-blue)', nota: 'retirados o en camino' },
    { label: 'ENTREGADOS', valor: entregados, color: 'var(--edr-verde)', nota: 'cerrados con foto' },
    { label: 'SIN SALIR', valor: sinSalir, color: 'var(--edr-naranja)', nota: 'siguen en el comercio' },
    { label: 'CON ATRASO', valor: atrasos.length, color: 'var(--edr-rojo)', nota: 'piden una decisión' },
  ];

  return (
    <div className="px-3 py-4 sm:px-6 sm:py-[22px]">
      <div className="flex flex-col gap-[18px]">
        {/* ---------- Los cinco números ---------- */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-3.5">
          {tiles.map((t) => (
            <div key={t.label} className={`${panel} px-4 py-3.5 sm:px-[18px] sm:py-4`}>
              <div className="font-bebas text-[13.5px] tracking-[.08em] text-[var(--edr-text-link)]">
                {t.label}
              </div>
              <div
                className="edr-mono text-[28px] font-extrabold leading-[1.05] tracking-[-.03em] sm:text-4xl"
                style={{ color: t.color }}
              >
                {cargando ? '—' : t.valor}
              </div>
              <div className="text-[12.5px] text-[var(--edr-text-4)]">{t.nota}</div>
            </div>
          ))}
        </div>

        <div className="grid items-start gap-[18px] xl:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-[18px]">
            {/* ---------- Lo que hay que decidir ---------- */}
            <section className={`${panel} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-2.5 border-b border-[#e0e9fd] px-4 py-4 sm:px-5">
                <AlertTriangle size={19} strokeWidth={2.2} className="text-[var(--edr-rojo)]" />
                <span className={titulo}>Necesita atención</span>
                {atrasos.length > 0 && (
                  <span className="edr-mono rounded-full bg-[var(--edr-rojo)] px-2 py-0.5 text-xs font-bold text-white">
                    {atrasos.length}
                  </span>
                )}
                <span className="ml-auto text-[12.5px] text-[var(--edr-text-4)]">
                  Se recalcula solo, cada minuto
                </span>
              </div>

              {atrasos.length === 0 ? (
                <div className="flex items-center gap-3 px-4 py-6 sm:px-5">
                  <CheckCircle2 size={22} strokeWidth={2.2} className="text-[var(--edr-verde)]" />
                  <div>
                    <div className="text-[15px] font-semibold text-[var(--edr-text)]">
                      {cargando ? 'Mirando el día…' : 'No hay nada atrasado'}
                    </div>
                    <div className="text-[12.5px] text-[var(--edr-text-4)]">
                      Todos los envíos de hoy tienen repartidor y se están moviendo.
                    </div>
                  </div>
                </div>
              ) : (
                atrasos.map((a) => <FilaAtraso key={a.clave} a={a} />)
              )}
            </section>

            {/* ---------- Quiénes están trabajando ---------- */}
            <section className={`${panel} px-4 py-[18px] sm:px-5`}>
              <div className="mb-3.5 flex items-center gap-2.5">
                <Bike size={19} strokeWidth={2.2} className="text-[var(--edr-blue)]" />
                <span className={titulo}>
                  {repartidores.length === 1 ? 'El de hoy' : `Los ${repartidores.length}, ahora`}
                </span>
                <Link
                  href="/admin/mapa"
                  className="ml-auto flex items-center gap-1.5 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-blue)]"
                >
                  VER EN EL MAPA
                  <ArrowUpRight size={15} strokeWidth={2.5} />
                </Link>
              </div>

              {repartidores.length === 0 ? (
                <p className="text-[13.5px] text-[var(--edr-text-4)]">
                  {cargando
                    ? 'Buscando…'
                    : 'Todavía no hay envíos de hoy asignados a ningún repartidor.'}
                </p>
              ) : (
                <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                  {repartidores.map((r) => (
                    <TarjetaRepartidor key={r.id} r={r} />
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ---------- La plata del día ---------- */}
          <div className="flex flex-col gap-[18px]">
            <div className="rounded-3xl bg-[var(--edr-yellow)] p-5 text-[var(--edr-blue)] shadow-[var(--edr-sombra)]">
              <div className="font-bebas text-base tracking-[.1em]">A COBRAR HOY EN LA CALLE</div>
              <div className="edr-mono text-[38px] font-extrabold leading-none tracking-[-.04em] sm:text-[44px]">
                {cargando ? '—' : money(aCobrar)}
              </div>
              <div className="text-[12.5px] font-semibold opacity-80">
                de los envíos que todavía no se entregaron
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilaAtraso({ a }: { a: Atraso }) {
  const Icono = ICONO_ACCION[a.tipo];
  const color = TONO[a.tono];

  return (
    <div className="flex flex-wrap items-center gap-3.5 border-b border-[var(--edr-panel-3)] px-4 py-3.5 last:border-b-0 sm:px-5">
      <span
        className="h-[38px] w-[5px] shrink-0 rounded-full"
        style={{ background: color }}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="font-bebas text-[15px] tracking-[.07em]" style={{ color }}>
          {a.titulo}
        </div>
        <div className="text-[15px] font-semibold text-[var(--edr-text)]">{a.detalle}</div>
        <div className="text-[12.5px] text-[var(--edr-text-4)]">{a.desde}</div>
      </div>
      <Link
        href={a.href}
        className="flex min-h-12 w-full shrink-0 items-center justify-center gap-[7px] rounded-full border border-[var(--edr-blue)] bg-white px-4 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-blue)] hover:bg-[var(--edr-blue-soft)] sm:w-auto"
      >
        <Icono size={15} strokeWidth={2.5} />
        {a.accion}
      </Link>
    </div>
  );
}

function TarjetaRepartidor({ r }: { r: Repartidor }) {
  const iniciales = r.nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  const pct = r.total ? Math.round((r.entregados / r.total) * 100) : 0;
  // Media hora sin señal en horario de reparto no es un dato de color: es que
  // no se sabe dónde está la moto ni si le pasó algo.
  const perdido = r.haceMinutos === null || r.haceMinutos > 30;

  return (
    <div className="rounded-[20px] border border-[var(--edr-divisor)] bg-[var(--edr-panel-2)] p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[var(--edr-blue)] font-anton text-sm text-[var(--edr-yellow)]">
          {iniciales}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-[var(--edr-text)]">{r.nombre}</div>
          <div className="text-xs text-[var(--edr-text-4)]">
            {r.haceMinutos === null ? 'sin señal hoy' : `GPS hace ${r.haceMinutos} min`}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="edr-mono text-xl font-extrabold tracking-[-.03em] text-[var(--edr-text)]">
          {r.entregados}/{r.total}
        </span>
        <span className="text-xs font-semibold text-[var(--edr-text-4)]">entregados</span>
      </div>

      <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-[var(--edr-divisor)]">
        <div className="h-full rounded-full bg-[var(--edr-blue)]" style={{ width: `${pct}%` }} />
      </div>

      {r.lleva > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-[var(--edr-yellow)] px-3 py-2 text-[var(--edr-blue)]">
          <span className="font-bebas text-[13.5px] tracking-[.07em]">LLEVA</span>
          <span className="edr-mono text-[15px] font-extrabold tracking-[-.03em]">
            {money(r.lleva)}
          </span>
        </div>
      )}

      {perdido && (
        <div className="mt-2.5 text-xs font-semibold text-[var(--edr-rojo)]">
          {r.haceMinutos === null
            ? 'No mandó ninguna señal hoy'
            : `Sin novedades hace ${r.haceMinutos} min`}
        </div>
      )}
    </div>
  );
}
