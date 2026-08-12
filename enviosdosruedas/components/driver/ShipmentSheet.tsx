'use client';

import { money, shipmentCash, type Shipment } from '@/lib/format';
import type { DeliveryKind } from '@/lib/driver/db';
import { dondeRetira } from '@/lib/pickup';
import { cuandoSeHace, esProgramado } from '@/lib/scheduled';
import MiniMapa from '@/components/driver/MiniMapa';
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
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--edr-paper)]">
      <header className="flex items-center justify-between bg-[var(--edr-surface-2)] px-4 py-3 text-white">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-black">{shipment.address_street}</h2>
          <p className="truncate text-xs font-bold uppercase text-[var(--edr-yellow)]">
            {shipment.client_name_raw || 'Sin comercio'}
          </p>
          <p className="edr-mono truncate text-xs opacity-80">{shipment.tracking_code}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg bg-[var(--edr-surface)]/15 px-4 py-2 text-base font-bold active:bg-[var(--edr-surface)]/25"
        >
          Volver
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {flex && (
          <div className="rounded-2xl border-4 border-black bg-[var(--edr-yellow)] px-4 py-4 text-center text-black">
            <div className="text-3xl font-black leading-none">ENVÍO FLEX</div>
            <div className="mt-2 text-lg font-black leading-tight">
              COMPLETAR EN LA APP DE ENVÍOS FLEX
            </div>
            <p className="mt-2 text-sm font-bold">
              Acá no se cobra. Cerralo primero en Envíos Flex y recién después tocá
              &quot;Entregado&quot;.
            </p>
            <div className="mt-2 border-t-2 border-black/30 pt-2 text-base font-black leading-tight">
              📷 LA FOTO SÍ VA ACÁ: EL PAQUETE CON LA FACHADA DE FONDO
            </div>
          </div>
        )}

        {cash.total > 0 && (
          <div className="rounded-2xl border-4 border-black bg-[var(--edr-fluo)] px-4 py-4 text-center text-black">
            <div className="text-base font-black uppercase tracking-widest">
              {cash.atDelivery > 0 ? 'Cobrar en la puerta' : 'Cobrar al retirar'}
            </div>
            <div className="edr-mono text-5xl font-black leading-none">
              {money(cash.atDelivery > 0 ? cash.atDelivery : cash.atPickup)}
            </div>
            {cash.atDelivery > 0 && shipment.merchandise_amount > 0 && (
              <div className="edr-mono mt-1 text-sm font-bold">
                envío {money(shipment.shipping_fee)} + mercadería{' '}
                {money(shipment.merchandise_amount)}
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border-2 border-sky-400 bg-[var(--edr-surface)] px-4 py-3">
          <div className="text-xs font-bold uppercase tracking-wide text-sky-400">Retirar en</div>
          <div className="text-lg font-black leading-snug">
            {dondeRetira(shipment.pickup_address)}
          </div>
          {shipment.pickup_notes && (
            <div className="mt-1 text-sm text-[var(--edr-muted)]">{shipment.pickup_notes}</div>
          )}
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
              dondeRetira(shipment.pickup_address),
            )}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block rounded-lg border border-sky-400 px-3 py-2 text-center text-sm font-black text-sky-400"
          >
            🗺️ Cómo llegar al retiro
          </a>
        </div>

        <Row label="Destinatario" value={shipment.recipient_name} />
        {shipment.address_extra && <Row label="Piso / depto" value={shipment.address_extra} />}
        <Row
          label="Localidad"
          value={`${shipment.city}${shipment.delivery_window ? ` · ${shipment.delivery_window}` : ''}`}
        />
        {shipment.product_detail && <Row label="Producto" value={shipment.product_detail} />}
        {shipment.notes && <Row label="Notas" value={shipment.notes} />}
        {shipment.client_name_raw && <Row label="Comercio" value={shipment.client_name_raw} />}

        {/* Va justo arriba de los botones: primero se entiende dónde es, y
            recién después se decide si llamar o arrancar para allá. */}
        <MiniMapa lat={shipment.lat} lng={shipment.lng} />

        <div className="grid grid-cols-2 gap-3 pt-1">
          {shipment.recipient_phone && (
            <a
              href={`tel:${shipment.recipient_phone}`}
              className="rounded-xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-4 py-4 text-center text-lg font-black"
            >
              📞 Llamar
            </a>
          )}
          {waUrl && (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border-2 border-emerald-400 bg-emerald-600 px-4 py-4 text-center text-lg font-black text-white"
            >
              💬 WhatsApp
            </a>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="col-span-2 rounded-xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-4 py-4 text-center text-lg font-black"
          >
            🗺️ Cómo llegar a destino
          </a>
        </div>
      </div>

      <div className="space-y-3 border-t-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {/* Programado para otro día: puede mirar la dirección y el teléfono,
            pero ningún botón de acción. La base lo rechazaría igual. */}
        {programado && (
          <div className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-4 py-5 text-center">
            <div className="text-lg font-black">🗓️ Se reparte {cuandoSeHace(shipment.scheduled_date)}</div>
            <p className="mt-1 text-sm font-semibold text-[var(--edr-muted)]">
              Hasta ese día no se puede retirar ni entregar. Está acá para que sepas lo que viene.
            </p>
          </div>
        )}

        {/* Los pasos previos a entregar, en el orden en que pasan en la calle. */}
        {!programado && sinRetirar && (
          <>
            <button
              onClick={() => onEstado(shipment, 'retirado')}
              className="w-full rounded-2xl bg-sky-600 px-6 py-5 text-xl font-black text-white active:scale-[0.99]"
            >
              📦 Ya lo retiré
            </button>
            <p className="text-center text-sm font-semibold text-[var(--edr-muted)]">
              Marcá el retiro para poder entregarlo.
            </p>
          </>
        )}

        {!programado && shipment.status === 'retirado' && (
          <button
            onClick={() => onEstado(shipment, 'en_camino')}
            className="w-full rounded-2xl bg-[var(--edr-blue)] px-6 py-4 text-lg font-black text-white active:scale-[0.99]"
          >
            🛵 Salgo en camino
          </button>
        )}

        {!programado && !sinRetirar && (
          <button
            onClick={() => onResolve('entregado')}
            className="w-full rounded-2xl bg-emerald-600 px-6 py-6 text-2xl font-black text-white active:scale-[0.99]"
          >
            ✅ Entregado
          </button>
        )}
        {!programado && !sinRetirar && (
          <button
            onClick={() => onResolve('no_entregado')}
            className={`w-full rounded-2xl bg-orange-600 font-black text-white active:scale-[0.99] ${
              flex ? 'px-4 py-3 text-base' : 'px-6 py-5 text-xl'
            }`}
          >
            ⚠️ No entregado
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)]">{label}</div>
      <div className="text-lg font-semibold leading-snug">{value}</div>
    </div>
  );
}
