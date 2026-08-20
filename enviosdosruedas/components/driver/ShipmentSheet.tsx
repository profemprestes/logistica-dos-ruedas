'use client';

import { money,
  nombreDelDestinatario, shipmentCash, STATUS_LABEL, type Shipment } from '@/lib/format';
import type { DeliveryKind } from '@/lib/driver/db';
import { dondeRetira } from '@/lib/pickup';
import { cuandoSeHace, esProgramado } from '@/lib/scheduled';
import {
  AlertTriangle,
  Bike,
  CalendarClock,
  Camera,
  Check,
  ChevronLeft,
  MessageCircle,
  Navigation,
  Package,
  PackageCheck,
  Phone,
} from 'lucide-react';
import MiniMapa from '@/components/driver/MiniMapa';
import { useCerrarConAtras } from '@/lib/driver/useAtras';
import { trackUrl } from '@/lib/trackUrl';

/** Detalle del envío con las dos únicas salidas posibles: entregado o no entregado. */
export default function ShipmentSheet({
  shipment,
  onClose,
  onResolve,
  onEstado,
}: {
  shipment: Shipment;
  onClose: () => void;
  onResolve: (kind: DeliveryKind) => void;
  onEstado: (shipment: Shipment, estado: 'retirado' | 'en_camino') => void;
}) {
  // El atrás del celular vuelve a la hoja de ruta, no sale de la app.
  useCerrarConAtras(onClose);

  const cash = shipmentCash(shipment);
  const flex = Boolean(shipment.is_flex);
  /** Cargado para otro día: se mira, no se toca. */
  const programado = esProgramado(shipment);
  /** Sin retirar no hay nada que entregar: el paquete todavía está en el comercio. */
  const sinRetirar = shipment.status === 'creado' || shipment.status === 'pendiente_retiro';
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${shipment.address_street}, ${shipment.city}`,
  )}`;

  /**
   * WhatsApp necesita el número sin espacios ni signos y con código de país.
   * Los teléfonos vienen cargados de mil formas ("223 555-1234", "+54 9 223...");
   * esto los normaliza al formato argentino 549XXXXXXXXXX.
   */
  const waNumber = (() => {
    const solo = (shipment.recipient_phone ?? '').replace(/\D/g, '');
    if (!solo) return null;
    if (solo.startsWith('54')) return solo.startsWith('549') ? solo : `549${solo.slice(2)}`;
    if (solo.startsWith('9')) return `54${solo}`;
    if (solo.startsWith('0')) return `549${solo.slice(1)}`;
    return `549${solo}`;
  })();

  /**
   * El mensaje que le llega al destinatario.
   *
   * Lleva de quién es el paquete porque el que recibe casi nunca conoce a
   * "Envíos DosRuedas": conoce al comercio al que le compró. Sin ese dato el
   * mensaje parece spam y no lo contestan.
   *
   * Y lleva el link de seguimiento en vez del código suelto: con el código hay
   * que entrar a la página y tipearlo; con el link se toca y listo.
   */
  const waTexto = [
    `Hola! Soy de Envíos DosRuedas, estoy llegando con tu envío${
      shipment.client_name_raw ? ` de ${shipment.client_name_raw}` : ''
    }.`,
    `Seguilo acá: ${trackUrl(shipment.tracking_code)}`,
  ].join('\n');

  const waUrl = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(waTexto)}` : null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--edr-dark)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 font-bebas text-base tracking-[.08em] text-[var(--edr-muted)] transition active:scale-95"
        >
          <ChevronLeft size={18} strokeWidth={2.5} />
          HOJA DE RUTA
        </button>
      </header>

      <div className="flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        {/* Quién manda el paquete y en qué anda, arriba de todo: es lo que
            ubica al repartidor antes de leer la dirección. */}
        <div>
          <div className="font-bebas text-[15px] tracking-[.08em] text-[var(--edr-yellow)]">
            {[shipment.client_name_raw || 'Sin comercio', STATUS_LABEL[shipment.status]]
              .join(' · ')
              .toUpperCase()}
          </div>
          <h2 className="mt-1 font-anton text-4xl uppercase leading-[.95] tracking-[-.02em] text-white">
            {shipment.address_street}
          </h2>
          {shipment.address_extra && (
            <div className="mt-1 text-base font-semibold text-[var(--edr-blue-soft)]">
              {shipment.address_extra}
            </div>
          )}
          <div className="edr-mono text-[13px] text-[var(--edr-muted)]">
            {shipment.tracking_code}
          </div>
        </div>

        {flex && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-[var(--edr-blue-soft)] px-4 py-3.5 text-[var(--edr-blue-dark)]">
            <Camera size={20} strokeWidth={2} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-bebas text-[17px] tracking-[.06em]">
                FLEX · CERRALO EN LA APP DE ELLOS
              </div>
              <p className="mt-0.5 text-sm font-semibold">
                Acá no se cobra. La foto del paquete con la fachada de fondo sí va acá.
              </p>
            </div>
          </div>
        )}

        {cash.total > 0 && (
          <div className="rounded-3xl bg-[var(--edr-yellow)] p-5 text-[var(--edr-blue)] shadow-[var(--edr-sombra)]">
            <div className="font-bebas text-[17px] tracking-[.1em]">
              {cash.atDelivery > 0 ? 'COBRAR EN LA PUERTA' : 'COBRAR AL RETIRAR'}
            </div>
            <div className="edr-mono text-[52px] font-extrabold leading-[.95] tracking-[-.04em]">
              {money(cash.atDelivery > 0 ? cash.atDelivery : cash.atPickup)}
            </div>
            {cash.atDelivery > 0 && shipment.merchandise_amount > 0 && (
              <div className="edr-mono text-[13px] font-semibold opacity-80">
                envío {money(shipment.shipping_fee)} + mercadería{' '}
                {money(shipment.merchandise_amount)}
              </div>
            )}
          </div>
        )}

        {sinRetirar && (
          <div className="space-y-2.5 rounded-3xl border border-white/10 bg-[var(--edr-blue)] p-4">
            <div className="flex items-center gap-2 font-bebas text-[15px] tracking-[.08em] text-[var(--edr-yellow)]">
              <Package size={16} strokeWidth={2} />
              RETIRAR EN
            </div>
            <div className="text-lg font-bold leading-snug text-white">
              {dondeRetira(shipment.pickup_address)}
            </div>
            {shipment.pickup_notes && (
              <div className="text-sm text-[var(--edr-muted)]">{shipment.pickup_notes}</div>
            )}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                dondeRetira(shipment.pickup_address),
              )}`}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-14 items-center justify-center gap-2 rounded-full border border-[var(--edr-yellow)] font-bebas text-lg tracking-[.06em] text-[var(--edr-yellow)] transition active:scale-95"
            >
              <Navigation size={18} strokeWidth={2} />
              CÓMO LLEGAR AL RETIRO
            </a>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <Dato label="DESTINATARIO" value={nombreDelDestinatario(shipment)} />
          <Dato label="VENTANA" value={shipment.delivery_window || 'Sin ventana'} />
        </div>

        {shipment.product_detail && <Dato label="PRODUCTO" value={shipment.product_detail} />}
        {shipment.notes && <Dato label="NOTAS" value={shipment.notes} />}

        {/* Va justo arriba de los botones: primero se entiende dónde es, y
            recién después se decide si llamar o arrancar para allá. */}
        <div>
          <MiniMapa lat={shipment.lat} lng={shipment.lng} />
          <p className="mt-1 text-center text-xs text-[var(--edr-muted)]">
            Referencia aproximada. Para llegar, usá el botón de abajo.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {shipment.recipient_phone && (
            <a
              href={`tel:${shipment.recipient_phone}`}
              className="flex min-h-14 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/[.06] font-bebas text-lg tracking-[.06em] text-white transition active:scale-95"
            >
              <Phone size={19} strokeWidth={2} />
              LLAMAR
            </a>
          )}
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-14 items-center justify-center gap-2 rounded-full border border-white/20 bg-white/[.06] font-bebas text-lg tracking-[.06em] text-white transition active:scale-95"
            >
              <MessageCircle size={19} strokeWidth={2} className="text-[var(--edr-whatsapp)]" />
              WHATSAPP
            </a>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="col-span-2 flex min-h-14 items-center justify-center gap-2 rounded-full border border-[var(--edr-yellow)] font-bebas text-lg tracking-[.06em] text-[var(--edr-yellow)] transition active:scale-95"
          >
            <Navigation size={19} strokeWidth={2} />
            CÓMO LLEGAR A DESTINO
          </a>
        </div>
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-white/10 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* Programado para otro día: puede mirar la dirección y el teléfono,
            pero ningún botón de acción. La base lo rechazaría igual. */}
        {programado && (
          <div className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-4 py-5 text-center">
            <div className="flex items-center justify-center gap-2 font-bebas text-lg tracking-[.06em] text-white">
              <CalendarClock size={20} strokeWidth={2} />
              SE REPARTE {cuandoSeHace(shipment.scheduled_date).toUpperCase()}
            </div>
            <p className="mt-1 text-sm font-semibold text-[var(--edr-muted)]">
              Hasta ese día no se puede retirar ni entregar. Está acá para que sepas lo que viene.
            </p>
          </div>
        )}

        {/* Los pasos previos a entregar, en el orden en que pasan en la calle. */}
        {!programado && sinRetirar && (
          <>
            {/* Naranja, igual que en la tarjeta de la hoja de ruta: el mismo
                paso tiene que tener el mismo color en las dos pantallas. */}
            <button
              onClick={() => onEstado(shipment, 'retirado')}
              style={{ background: 'var(--edr-naranja)' }}
              className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full font-bebas text-[26px] tracking-[.06em] text-white transition active:scale-95"
            >
              <PackageCheck size={26} strokeWidth={2.5} />
              YA LO RETIRÉ
            </button>
            <p className="text-center text-sm font-semibold text-[var(--edr-muted)]">
              Marcá el retiro para poder entregarlo.
            </p>
          </>
        )}

        {!programado && shipment.status === 'retirado' && (
          <button
            onClick={() => onEstado(shipment, 'en_camino')}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--edr-yellow)] font-bebas text-xl tracking-[.06em] text-[var(--edr-yellow)] transition active:scale-95"
          >
            <Bike size={22} strokeWidth={2} />
            SALGO EN CAMINO
          </button>
        )}

        {/*
          LOS DOS FINALES DE UN ENVÍO, cada uno con su color.
          Antes los dos eran amarillos —uno lleno y otro con borde— y la única
          diferencia era leer el texto. Estos dos botones son los que cierran el
          envío y no tienen vuelta atrás desde el celular: tocar el que no era
          se arregla desde el panel, con una llamada de por medio.

          El tamaño no cambia y sigue mandando: ENTREGADO es el grande porque es
          el que se toca casi siempre. El color ahora acompaña en vez de estorbar.
        */}
        {!programado && !sinRetirar && (
          <>
            {/* El verde va por estilo directo y no por clase: la clase de
                Tailwind para este color no llegaba a generarse en desarrollo
                —sí en la compilación final— y un botón que sólo se puede
                verificar en producción no se puede dar por bueno. */}
            <button
              onClick={() => onResolve('entregado')}
              style={{ background: 'var(--edr-verde)' }}
              className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full font-bebas text-[26px] tracking-[.06em] text-white transition active:scale-95"
            >
              <Check size={28} strokeWidth={3} />
              ENTREGADO
            </button>
            <button
              onClick={() => onResolve('no_entregado')}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--edr-rojo-claro)] font-bebas text-lg tracking-[.06em] text-[var(--edr-rojo-claro)] transition active:scale-95"
            >
              <AlertTriangle size={20} strokeWidth={2} />
              NO SE PUDO ENTREGAR
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Un dato suelto del envío, en su cajita. */
function Dato({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[.04] p-3.5">
      <div className="font-bebas text-[13px] tracking-[.08em] text-[var(--edr-muted)]">{label}</div>
      <div className="text-base font-semibold text-white">{value}</div>
    </div>
  );
}
