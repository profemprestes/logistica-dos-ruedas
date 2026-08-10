'use client';

import { money, shipmentCash, STATUS_LABEL, type Shipment } from '@/lib/format';

/**
 * Tarjeta de la hoja de ruta.
 *
 * Si hay plata para cobrar la tarjeta cambia entera: amarillo flúor, borde negro
 * grueso y el monto en el cuerpo más grande de la pantalla. El objetivo es que
 * sea imposible entregar un paquete a cobrar sin darse cuenta.
 */
export default function ShipmentCard({
  shipment,
  onOpen,
}: {
  shipment: Shipment;
  onOpen: (shipment: Shipment) => void;
}) {
  const cash = shipmentCash(shipment);
  const cobra = cash.total > 0;
  const flex = Boolean(shipment.is_flex);

  return (
    <button
      onClick={() => onOpen(shipment)}
      className={`w-full rounded-2xl px-4 py-4 text-left active:scale-[0.99] ${
        cobra
          ? 'border-4 border-black bg-[var(--edr-fluo)] text-black'
          : 'border-2 border-[var(--edr-border)] bg-[var(--edr-surface)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`edr-mono text-xs font-bold ${cobra ? 'text-black/70' : 'text-[var(--edr-muted)]'}`}>
          {shipment.tracking_code}
        </span>
        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-bold uppercase">
          {STATUS_LABEL[shipment.status]}
        </span>
      </div>

      {/* De qué comercio es: el repartidor lo necesita para saber dónde retirar
          y para nombrarlo cuando llama al destinatario. */}
      {shipment.client_name_raw && (
        <div
          className={`mt-1 text-sm font-black uppercase tracking-wide ${
            cobra ? 'text-black/70' : 'text-[var(--edr-yellow)]'
          }`}
        >
          {shipment.client_name_raw}
        </div>
      )}

      {flex && (
        <div className="mt-2 rounded-xl border-4 border-black bg-[var(--edr-yellow)] px-3 py-2 text-center text-black">
          <div className="text-xl font-black leading-none tracking-wide">ENVÍO FLEX</div>
          <div className="mt-1 text-sm font-black leading-tight">
            COMPLETAR EN LA APP DE ENVÍOS FLEX
          </div>
        </div>
      )}

      <div className="mt-1 text-2xl font-black leading-tight">{shipment.address_street}</div>
      {shipment.address_extra && (
        <div className="text-lg font-bold">{shipment.address_extra}</div>
      )}

      <div className={`text-base font-semibold ${cobra ? 'text-black/80' : 'text-[var(--edr-muted)]'}`}>
        {shipment.recipient_name}
        {shipment.delivery_window ? ` · ${shipment.delivery_window}` : ''}
      </div>

      {cobra && (
        <div className="mt-3 rounded-xl bg-black px-3 py-3 text-center text-white">
          <div className="text-sm font-black uppercase tracking-widest">
            {cash.atDelivery > 0 ? 'Cobrar' : 'Cobrar al retirar'}
          </div>
          <div className="edr-mono text-4xl font-black leading-none">
            {money(cash.atDelivery > 0 ? cash.atDelivery : cash.atPickup)}
          </div>
        </div>
      )}
    </button>
  );
}
