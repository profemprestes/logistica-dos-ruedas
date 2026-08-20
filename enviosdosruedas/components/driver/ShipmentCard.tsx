'use client';

import { Bike, Camera, Check, Navigation, Package, PackageCheck, Phone } from 'lucide-react';
import { money, shipmentCash, STATUS_LABEL, type Shipment } from '@/lib/format';
import { dondeRetira } from '@/lib/pickup';
import { cuandoSeHace, esProgramado } from '@/lib/scheduled';
import { lasOtras, type Puesto } from '@/lib/entregas';

/**
 * Tarjeta de la hoja de ruta.
 *
 * EL ORDEN DE LO QUE SE LEE es la decisión de fondo, y va de lo que hace falta
 * primero a lo que hace falta después: el código chico arriba, el comercio,
 * y enseguida LA DIRECCIÓN, que es el dato por el que se mira la pantalla —29px
 * en Anton, que se lee de reojo con el casco puesto—. Abajo, sólo si hay,
 * la franja de plata; y al pie, la acción.
 *
 * LA PLATA NO PINTA LA TARJETA ENTERA, como antes: va en una franja amarilla
 * con el monto en monoespaciada de 26px. Pintar todo de amarillo hacía que la
 * dirección —lo que hay que leer— compitiera con el monto, y en una hoja de
 * veinte envíos la mitad quedaba en fluo y el efecto se perdía.
 *
 * Las tres acciones de abajo son las tres cosas que se hacen parado en la
 * puerta: el paso siguiente, llamar y cómo llegar. Todas de 56px, que es el
 * mínimo para acertarle con guantes.
 */
export default function ShipmentCard({
  shipment,
  onOpen,
  onEstado,
  onCerrarEntrega,
  puesto,
}: {
  shipment: Shipment;
  onOpen: (shipment: Shipment) => void;
  /** Marcar retirado / en camino sin tener que entrar al envío. */
  onEstado: (shipment: Shipment, estado: 'retirado' | 'en_camino') => void;
  /** Abrir el cierre de entrega. Sin esto, el botón lleva al detalle. */
  onCerrarEntrega?: (shipment: Shipment) => void;
  /**
   * Si este paquete es una de varias entregas del mismo envío (paso 53).
   *
   * Va en la tarjeta y no adentro del envío porque el momento en que hace
   * falta es parado en el mostrador del comercio, mirando la lista: ahí se
   * decide si se lleva uno o dos, y adentro del envío no entra nadie antes de
   * cargar la moto.
   */
  puesto?: Puesto;
}) {
  const programado = esProgramado(shipment);
  const cash = shipmentCash(shipment);
  // Un envío de mañana no se cobra hoy: la franja de plata se apaga para que
  // la hoja de hoy se siga leyendo de un vistazo.
  const cobra = cash.total > 0 && !programado;
  const flex = Boolean(shipment.is_flex);
  const sinRetirar = shipment.status === 'pendiente_retiro' || shipment.status === 'creado';

  /*
   * CADA PASO CON SU COLOR, y el último distinto de los otros dos.
   *
   * Los tres botones eran amarillos. En la mano, andando, el repartidor no lee
   * el texto: reconoce la forma y el color y aprieta. Con los tres iguales, el
   * de cerrar la entrega —el único que termina el envío y el único que no
   * tiene vuelta atrás— se tocaba con la misma liviandad que "salgo en camino".
   *
   * Naranja el retiro, amarillo el "salgo", verde el que cierra. Los tres
   * pasos del envío en el orden en que pasan, y cada uno con su color. Lo pidió
   * un repartidor, que es quien los aprieta doscientas veces por semana.
   */
  const accion = sinRetirar
    ? {
        label: 'YA LO RETIRÉ',
        Icono: PackageCheck,
        hacer: () => onEstado(shipment, 'retirado'),
        fondo: 'var(--edr-naranja)',
        texto: '#fff',
      }
    : shipment.status === 'retirado'
      ? {
          label: 'SALGO EN CAMINO',
          Icono: Bike,
          hacer: () => onEstado(shipment, 'en_camino'),
          fondo: 'var(--edr-yellow)',
          texto: 'var(--edr-blue)',
        }
      : {
          label: 'CERRAR ENTREGA',
          Icono: Check,
          hacer: () => (onCerrarEntrega ?? onOpen)(shipment),
          fondo: 'var(--edr-verde)',
          texto: '#fff',
        };

  const comoLlegar =
    shipment.lat != null && shipment.lng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${shipment.lat},${shipment.lng}`
      : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          `${shipment.address_street}, ${shipment.city}, Argentina`,
        )}`;

  return (
    <div
      className={`flex flex-col gap-3 rounded-3xl border p-4 ${
        programado
          ? 'border-dashed border-[var(--edr-border)] bg-[var(--edr-blue)] opacity-75'
          : 'border-white/10 bg-[var(--edr-blue)] shadow-[var(--edr-sombra)]'
      }`}
    >
      <button
        onClick={() => onOpen(shipment)}
        className="flex flex-col gap-2 text-left"
      >
        <span className="flex items-center justify-between gap-2">
          <span className="edr-mono text-xs font-bold tracking-[-.02em] text-[var(--edr-muted)]">
            {shipment.tracking_code}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 font-bebas text-[13px] tracking-[.08em] text-[var(--edr-yellow)]">
            {STATUS_LABEL[shipment.status]}
          </span>
        </span>

        {shipment.client_name_raw && (
          <span className="font-bebas text-[15px] tracking-[.08em] text-[var(--edr-yellow)]">
            {shipment.client_name_raw}
          </span>
        )}

        <span className="font-anton text-[29px] uppercase leading-[.98] tracking-[-.02em] text-white">
          {shipment.address_street}
        </span>

        {shipment.address_extra && (
          <span className="text-base font-semibold text-white">{shipment.address_extra}</span>
        )}

        <span className="text-[15px] font-medium text-[var(--edr-muted)]">
          {[shipment.recipient_name, shipment.delivery_window].filter(Boolean).join(' · ')}
        </span>

        {/* Durante meses un FLEX se cerró sin foto. El aviso va acá, en la hoja
            de ruta, y no sólo adentro del envío: la costumbre vieja se corta
            cuando el repartidor lee el cambio antes de tocar nada. */}
        {/* SON DOS PAQUETES. Es el aviso que evita el error caro de este
            envío: irse del comercio con uno solo y tener que volver. Por eso
            está en amarillo y arriba de la plata. */}
        {puesto && (
          <span className="flex flex-col gap-0.5 rounded-xl bg-[var(--edr-yellow)] px-3 py-2.5 text-[var(--edr-blue)]">
            <span className="flex items-center gap-2 font-bebas text-[15px] tracking-[.05em]">
              <Package size={16} strokeWidth={2} className="shrink-0" />
              ENTREGA {puesto.numero} DE {puesto.total} · SON {puesto.total} PAQUETES
            </span>
            <span className="text-[13px] font-semibold leading-tight">
              {lasOtras(puesto, shipment.id)
                .map((e) => e.address_street)
                .join(' · ')}
            </span>
          </span>
        )}

        {flex && (
          <span className="flex items-center gap-2 rounded-xl bg-[var(--edr-blue-soft)] px-3 py-2.5 font-bebas text-[15px] tracking-[.05em] text-[var(--edr-blue-dark)]">
            <Camera size={16} strokeWidth={2} className="shrink-0" />
            FLEX · CERRALO EN SU APP, LA FOTO VA ACÁ
          </span>
        )}

        {sinRetirar && shipment.pickup_address && (
          <span className="flex items-center gap-2 rounded-xl bg-white/[.08] px-3 py-2.5 text-sm font-semibold text-[var(--edr-blue-soft)]">
            <Package size={16} strokeWidth={2} className="shrink-0 text-[var(--edr-yellow)]" />
            Retirar en {dondeRetira(shipment.pickup_address)}
          </span>
        )}

        {cobra && (
          <span className="flex items-center justify-between gap-3 rounded-2xl bg-[var(--edr-yellow)] px-4 py-3 text-[var(--edr-blue)]">
            <span className="font-bebas text-base tracking-[.08em]">
              {cash.atPickup > 0 ? 'COBRAR AL RETIRAR' : 'COBRAR EN LA PUERTA'}
            </span>
            <span className="edr-mono text-[26px] font-extrabold tracking-[-.03em]">
              {money(cash.total)}
            </span>
          </span>
        )}
      </button>

      {/* Programado: se ve para que sepa lo que le viene, pero no se toca.
          El botón se reemplaza por el motivo, así no busca dónde apretar. */}
      {programado ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-4 py-3 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-muted)]">
          SE HACE {cuandoSeHace(shipment.scheduled_date).toUpperCase()} · NO SE TOCA
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={accion.hacer}
            style={{ background: accion.fondo, color: accion.texto }}
            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full px-4 font-bebas text-xl tracking-[.06em] transition active:scale-95"
          >
            <accion.Icono size={19} strokeWidth={2.5} />
            {accion.label}
          </button>

          {shipment.recipient_phone && (
            <a
              href={`tel:${shipment.recipient_phone}`}
              aria-label="Llamar"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/[.06] text-white transition active:scale-95"
            >
              <Phone size={20} strokeWidth={2} />
            </a>
          )}

          <a
            href={comoLlegar}
            target="_blank"
            rel="noreferrer"
            aria-label="Cómo llegar"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/[.06] text-white transition active:scale-95"
          >
            <Navigation size={20} strokeWidth={2} />
          </a>
        </div>
      )}
    </div>
  );
}
