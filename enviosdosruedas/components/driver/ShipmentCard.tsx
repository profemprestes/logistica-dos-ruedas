'use client';

import { money, shipmentCash, STATUS_LABEL, type Shipment } from '@/lib/format';
import { dondeRetira } from '@/lib/pickup';
import { cuandoSeHace, esProgramado } from '@/lib/scheduled';

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
  onEstado,
}: {
  shipment: Shipment;
  onOpen: (shipment: Shipment) => void;
  /** Marcar retirado / en camino sin tener que entrar al envío. */
  onEstado: (shipment: Shipment, estado: 'retirado' | 'en_camino') => void;
}) {
  const programado = esProgramado(shipment);
  const cash = shipmentCash(shipment);
  // Un envío de mañana no se cobra hoy: apagamos el amarillo flúor para que la
  // hoja de ruta de hoy se siga leyendo de un vistazo.
  const cobra = cash.total > 0 && !programado;
  const flex = Boolean(shipment.is_flex);

  return (
    <div
      className={`w-full rounded-2xl px-4 py-4 text-left ${
        cobra
          ? 'border-4 border-black bg-[var(--edr-fluo)] text-black'
          : programado
            ? 'border-2 border-dashed border-[var(--edr-border)] bg-[var(--edr-surface)] opacity-75'
            : 'border-2 border-[var(--edr-border)] bg-[var(--edr-surface)]'
      }`}
    >
      <button onClick={() => onOpen(shipment)} className="block w-full text-left">
      <div className="flex items-start justify-between gap-2">
        <span className={`edr-mono text-xs font-bold ${cobra ? 'text-black/70' : 'text-[var(--edr-muted)]'}`}>
          {shipment.tracking_code}
        </span>
        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-bold uppercase">
          {programado ? `Para ${cuandoSeHace(shipment.scheduled_date)}` : STATUS_LABEL[shipment.status]}
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

      {/* Dónde retirar: sin esto el repartidor no sabe adónde ir a buscarlo. */}
      {(shipment.status === 'pendiente_retiro' || shipment.status === 'creado') && (
        <div
          className={`mt-2 rounded-lg px-3 py-2 text-sm font-bold ${
            cobra ? 'bg-black/10' : 'bg-[var(--edr-surface-2)]'
          }`}
        >
          📦 Retirar en: {dondeRetira(shipment.pickup_address)}
        </div>
      )}

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

      {/* Programado: se ve para que sepa lo que le viene, pero no se toca.
          El botón se reemplaza por el motivo, así no busca dónde apretar. */}
      {programado ? (
        <div className="mt-3 rounded-xl border-2 border-dashed border-[var(--edr-border)] px-4 py-3 text-center text-sm font-bold text-[var(--edr-muted)]">
          🗓️ Se hace {cuandoSeHace(shipment.scheduled_date)} · todavía no se puede tocar
        </div>
      ) : (
        <>
          {/* El paso siguiente, a un toque, sin entrar al envío. */}
          {(shipment.status === 'pendiente_retiro' || shipment.status === 'creado') && (
            <button
              onClick={() => onEstado(shipment, 'retirado')}
              className="mt-3 w-full rounded-xl bg-sky-600 px-4 py-3 text-base font-black text-white active:scale-[0.99]"
            >
              📦 Ya lo retiré
            </button>
          )}

          {shipment.status === 'retirado' && (
            <button
              onClick={() => onEstado(shipment, 'en_camino')}
              className="mt-3 w-full rounded-xl bg-[var(--edr-blue)] px-4 py-3 text-base font-black text-white active:scale-[0.99]"
            >
              🛵 Salgo en camino
            </button>
          )}
        </>
      )}
    </div>
  );
}
