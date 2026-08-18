'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Bike,
  CalendarClock,
  CheckCircle2,
  MapPin,
  PackageCheck,
  UserCheck,
} from 'lucide-react';
import { useAdminGuard } from '@/lib/adminGuard';
import { ETIQUETA_ESTADO, money, shipmentCash, type Shipment } from '@/lib/format';
import { useDatosDelDia, type Repartidor } from '@/components/admin/DatosDelDia';
import BuscarPaquete from '@/components/admin/BuscarPaquete';
import ColectasPendientes from '@/components/admin/ColectasPendientes';
import ProofOfDeliveryModal from '@/components/ProofOfDeliveryModal';
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
  rojo: 'var(--edr-rojo-claro)',
  naranja: 'var(--edr-naranja-claro)',
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
  /** El envío cuya prueba de entrega se está mirando, desde el buscador. */
  const [prueba, setPrueba] = useState<Shipment | null>(null);
  /** Lo último que se hizo con las colectas, para confirmarlo en pantalla. */
  const [aviso, setAviso] = useState('');

  /**
   * El repartidor cuya hoja de ruta se está mirando.
   *
   * Se abre tocando su tarjeta. Antes, para saber qué tenía en curso había que
   * irse a la tabla de envíos y filtrar por él a mano — tres pantallas para una
   * pregunta que se hace todo el tiempo: "¿qué le queda a este?".
   */
  const [verRuta, setVerRuta] = useState<Repartidor | null>(null);

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-text-3)]">Cargando…</div>;

  const enCalle = deHoy.filter((s) => s.status === 'retirado' || s.status === 'en_camino').length;
  const sinSalir = deHoy.filter(
    (s) => s.status === 'creado' || s.status === 'pendiente_retiro',
  ).length;

  const tiles = [
    { label: 'ENVÍOS', valor: deHoy.length, color: 'var(--edr-text)', nota: 'programados hoy' },
    { label: 'EN LA CALLE', valor: enCalle, color: 'var(--edr-yellow)', nota: 'retirados o en camino' },
    { label: 'ENTREGADOS', valor: entregados, color: 'var(--edr-verde-claro)', nota: 'cerrados con foto' },
    { label: 'SIN SALIR', valor: sinSalir, color: 'var(--edr-naranja-claro)', nota: 'siguen en el comercio' },
    { label: 'CON ATRASO', valor: atrasos.length, color: 'var(--edr-rojo-claro)', nota: 'piden una decisión' },
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
              <div className="flex flex-wrap items-center gap-2.5 border-b border-[var(--edr-divisor)] px-4 py-4 sm:px-5">
                <AlertTriangle size={19} strokeWidth={2.2} className="text-[var(--edr-rojo-claro)]" />
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
                  <CheckCircle2 size={22} strokeWidth={2.2} className="text-[var(--edr-verde-claro)]" />
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

            {/* ---------- A quién mandaste a retirar ---------- */}
            <section className={`${panel} px-4 py-[18px] sm:px-5`}>
              <div className="mb-3.5 flex items-center gap-2.5">
                <PackageCheck size={19} strokeWidth={2.2} className="text-[var(--edr-yellow)]" />
                <span className={titulo}>Pasando a retirar</span>
              </div>

              {/*
                Acá y no escondido adentro del cuadro de "Mandar a retirar".

                La primera versión estuvo sólo ahí y no servía: para ver una
                colecta había que abrir la pantalla de crear otra. Una colecta
                sin hacer es estado del día igual que un envío atrasado, y el
                día se mira acá.
              */}
              <ColectasPendientes
                onAviso={setAviso}
                vacio={
                  <p className="text-[13.5px] text-[var(--edr-text-4)]">
                    Nadie está yendo a retirar a ningún comercio.
                  </p>
                }
              />

              {aviso && (
                <p className="mt-2.5 text-[13px] font-semibold text-[var(--edr-verde-claro)]">
                  {aviso}
                </p>
              )}
            </section>

            {/* ---------- Quiénes están trabajando ---------- */}
            <section className={`${panel} px-4 py-[18px] sm:px-5`}>
              <div className="mb-3.5 flex items-center gap-2.5">
                <Bike size={19} strokeWidth={2.2} className="text-[var(--edr-yellow)]" />
                <span className={titulo}>
                  {/* El cero tiene que decir el cero. Antes caía en "Los 0,
                      ahora", que no significa nada y encima suena a error del
                      sistema justo cuando lo que pasa es que todavía no
                      arrancó el día. */}
                  {repartidores.length === 0
                    ? 'Nadie con envíos todavía'
                    : repartidores.length === 1
                      ? 'El de hoy'
                      : `Los ${repartidores.length}, ahora`}
                </span>
                <Link
                  href="/admin/mapa"
                  className="ml-auto flex items-center gap-1.5 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-yellow)]"
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
                    <TarjetaRepartidor key={r.id} r={r} onVer={() => setVerRuta(r)} />
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

            <BuscarPaquete verPrueba={setPrueba} />
          </div>
        </div>
      </div>

      <ProofOfDeliveryModal shipment={prueba} onClose={() => setPrueba(null)} />

      {verRuta && (
        <RutaDelRepartidor r={verRuta} envios={deHoy} onCerrar={() => setVerRuta(null)} />
      )}
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
        className="flex min-h-12 w-full shrink-0 items-center justify-center gap-[7px] rounded-full border border-[var(--edr-yellow)] px-4 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-yellow)] hover:bg-white/10 sm:w-auto"
      >
        <Icono size={15} strokeWidth={2.5} />
        {a.accion}
      </Link>
    </div>
  );
}

/**
 * Lo que ese repartidor tiene sin cerrar, ahora mismo.
 *
 * SALE DE LO QUE EL PANEL YA TIENE CARGADO, sin pedirle nada al servidor: los
 * envíos del día ya están en pantalla para poder contar los números de arriba.
 * Abrir esto no cuesta ni una consulta ni una espera.
 *
 * Sólo los que están sin cerrar. Los entregados ya se cuentan en la tarjeta
 * ("7/9") y meterlos acá sería tapar los tres que importan con los seis que ya
 * no.
 */
function RutaDelRepartidor({
  r,
  envios,
  onCerrar,
}: {
  r: Repartidor;
  envios: Shipment[];
  onCerrar: () => void;
}) {
  const abiertos = envios
    .filter((s) => s.assigned_driver === r.id)
    .filter((s) => s.status !== 'entregado' && s.status !== 'cancelado');

  // En camino primero, después retirados, después los que ni salieron: es el
  // orden en que hay que preocuparse por ellos.
  const peso: Record<string, number> = {
    en_camino: 0,
    retirado: 1,
    pendiente_retiro: 2,
    creado: 3,
    pendiente_entrega: 4,
  };
  abiertos.sort((a, b) => (peso[a.status] ?? 9) - (peso[b.status] ?? 9));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
      onClick={onCerrar}
    >
      {/* El clic de adentro no cierra: si no, tocar la lista para leerla la
          hace desaparecer. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${panel} max-h-[85dvh] w-full max-w-lg overflow-y-auto p-4 sm:p-5`}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-anton text-[21px] uppercase leading-none tracking-[-.02em] text-[var(--edr-text)]">
              {r.nombre}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--edr-text-4)]">
              {abiertos.length === 0
                ? 'No le queda nada sin cerrar'
                : `${abiertos.length} sin cerrar · ${r.entregados} entregado${r.entregados === 1 ? '' : 's'} hoy`}
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" className="px-2 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {abiertos.map((s) => {
            const cobra = shipmentCash(s).atDelivery;
            return (
              <div
                key={s.id}
                className="rounded-2xl border border-[var(--edr-divisor)] bg-[var(--edr-panel-2)] px-3.5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="edr-mono text-[13px] font-bold text-[var(--edr-text-4)]">
                    {s.tracking_code}
                  </span>
                  <span className="font-bebas text-[13px] tracking-[.07em] text-[var(--edr-yellow)]">
                    {ETIQUETA_ESTADO[s.status]}
                  </span>
                  {cobra > 0 && (
                    <span className="edr-mono ml-auto rounded-full bg-[var(--edr-yellow)] px-2.5 py-0.5 text-[13px] font-extrabold text-[var(--edr-blue)]">
                      {money(cobra)}
                    </span>
                  )}
                </div>

                <div className="mt-0.5 text-[15px] font-semibold text-[var(--edr-text)]">
                  {s.address_street}
                  {s.address_extra ? ` · ${s.address_extra}` : ''}
                </div>

                <div className="text-[12.5px] text-[var(--edr-text-4)]">
                  {s.recipient_name}
                  {s.client_name_raw ? ` · de ${s.client_name_raw}` : ''}
                  {s.delivery_window ? ` · ${s.delivery_window}` : ''}
                </div>
              </div>
            );
          })}
        </div>

        {/* Los dos lugares a donde se puede querer seguir: la tabla para
            tocarlos, el mapa para ver por dónde andan. */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/admin?repartidor=${r.id}`}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--edr-yellow)] px-4 py-3 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-yellow)]"
          >
            VER EN LA TABLA
            <ArrowUpRight size={15} strokeWidth={2.5} />
          </Link>
          <Link
            href="/admin/mapa"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--edr-divisor)] px-4 py-3 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-text-4)]"
          >
            VER EN EL MAPA
            <ArrowUpRight size={15} strokeWidth={2.5} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function TarjetaRepartidor({ r, onVer }: { r: Repartidor; onVer: () => void }) {
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
    /* Toda la tarjeta es el botón, no un enlacito adentro: en el celular se
       toca con el pulgar sin apuntar, y la pregunta que se hace mirándola es
       siempre la misma — "¿qué le queda a este?". */
    <button
      onClick={onVer}
      className="rounded-[20px] border border-[var(--edr-divisor)] bg-[var(--edr-panel-2)] p-4 text-left transition hover:border-[var(--edr-yellow)]"
    >
      <div className="flex items-center gap-2.5">
        {/* Amarillo con la letra azul, como el de la barra lateral: el azul
            sobre azul se pierde y el redondel deja de leerse. */}
        <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-[var(--edr-yellow)] font-anton text-sm text-[var(--edr-blue)]">
          {iniciales}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-[var(--edr-text)]">{r.nombre}</div>
          <div className="text-xs text-[var(--edr-text-4)]">
            {r.haceMinutos === null ? 'sin señal hoy' : `GPS hace ${r.haceMinutos} min`}
          </div>

          {/*
            CÓMO LE MANDÓ EL GPS HOY, para poder contestar "¿es el sistema o es
            su teléfono?".

            El hueco más largo es el número que importa: uno con 90 minutos y
            otro con 2 el mismo día es el teléfono del primero matando la app en
            segundo plano, no el sistema. Sólo se muestra cuando pasa de 10
            minutos — abajo de eso es la calle, un túnel o un sótano, y no hay
            nada que hacer. Ver el paso 47.
          */}
          {r.senal && r.senal.huecoMaxMin > 10 && (
            <div className="text-xs font-semibold text-[var(--edr-naranja-claro)]">
              se cortó {r.senal.huecoMaxMin} min hoy
              {r.senal.bateriaMin !== null && r.senal.bateriaMin <= 25
                ? ` · bajó a ${r.senal.bateriaMin}% de batería`
                : ''}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="edr-mono text-xl font-extrabold tracking-[-.03em] text-[var(--edr-text)]">
          {r.entregados}/{r.total}
        </span>
        <span className="text-xs font-semibold text-[var(--edr-text-4)]">entregados</span>
      </div>

      <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-[var(--edr-divisor)]">
        <div className="h-full rounded-full bg-[var(--edr-yellow)]" style={{ width: `${pct}%` }} />
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
        <div className="mt-2.5 text-xs font-semibold text-[var(--edr-rojo-claro)]">
          {r.haceMinutos === null
            ? 'No mandó ninguna señal hoy'
            : `Sin novedades hace ${r.haceMinutos} min`}
        </div>
      )}

      <div className="mt-2.5 font-bebas text-[13px] tracking-[.07em] text-[var(--edr-yellow)]">
        VER QUÉ LE QUEDA
      </div>
    </button>
  );
}
