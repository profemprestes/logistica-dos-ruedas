'use client';

import {
  money,
  shipmentCash,
  STATUS_CLASS,
  STATUS_LABEL,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/format';
import { cuandoSeHace, esProgramado } from '@/lib/scheduled';
import CopyTrackLink from '@/components/admin/CopyTrackLink';

/**
 * El mismo envío que muestra la tabla, pero apilado para el teléfono.
 *
 * La tabla tiene siete columnas: en un celular hay que arrastrar de costado
 * para llegar a los botones, y así es imposible trabajar desde la calle. Acá
 * cada envío es una tarjeta con todo a la vista y los botones al final.
 *
 * Recibe los mismos handlers que la tabla a propósito: si mañana cambia una
 * acción, cambia en los dos lados o no cambia en ninguno.
 */
export default function ShipmentMobileCard({
  shipment,
  drivers,
  hasProof,
  mostrarFecha = false,
  onProof,
  onEdit,
  onPrint,
  onDelete,
  onStatus,
  onAssign,
}: {
  shipment: Shipment;
  drivers: { id: string; full_name: string }[];
  hasProof: boolean;
  /** Sólo cuando el listado mezcla días: si no, es ruido en cada tarjeta. */
  mostrarFecha?: boolean;
  onProof: (s: Shipment) => void;
  onEdit: (s: Shipment) => void;
  onPrint: (s: Shipment) => void;
  onDelete: (s: Shipment) => void;
  onStatus: (s: Shipment, status: ShipmentStatus) => void;
  onAssign: (s: Shipment, driverId: string) => void;
}) {
  const cash = shipmentCash(shipment);
  const programado = esProgramado(shipment);

  return (
    <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="edr-mono text-xs font-bold text-[var(--edr-muted)]">
          {shipment.tracking_code}
        </span>
        {programado && (
          <span className="rounded bg-[var(--edr-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-yellow)]">
            Para {cuandoSeHace(shipment.scheduled_date)}
          </span>
        )}
      </div>

      <div className="mt-1 text-base font-bold leading-tight">
        {shipment.address_street}
        {shipment.address_extra ? ` — ${shipment.address_extra}` : ''}
      </div>
      <div className="text-sm text-[var(--edr-muted)]">
        {shipment.recipient_name} · {shipment.city}
        {shipment.delivery_window ? ` · ${shipment.delivery_window}` : ''}
        {mostrarFecha && (
          <span className="edr-mono ml-1 text-[var(--edr-yellow)]">
            {shipment.scheduled_date.split('-').reverse().slice(0, 2).join('/')}
          </span>
        )}
      </div>
      {shipment.client_name_raw && (
        <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--edr-yellow)]">
          {shipment.client_name_raw}
        </div>
      )}

      {/* Plata: los mismos dos colores que en la tabla, que significan momentos
          de cobro distintos y no se pueden confundir. */}
      {cash.total > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {cash.atDelivery > 0 && (
            <span className="edr-mono bg-[var(--edr-hiviz)] px-2 py-1 text-sm font-bold text-black">
              {money(cash.atDelivery)}
            </span>
          )}
          {cash.atPickup > 0 && (
            <span className="edr-mono bg-orange-500 px-2 py-1 text-sm font-bold text-white">
              {money(cash.atPickup)}
              <span className="ml-1 text-[10px] uppercase">al retirar</span>
            </span>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <select
          value={shipment.status}
          onChange={(e) => onStatus(shipment, e.target.value as ShipmentStatus)}
          className={`w-full rounded px-2 py-2 text-xs font-semibold ring-1 ${STATUS_CLASS[shipment.status]}`}
        >
          {Object.entries(STATUS_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>

        <select
          value={shipment.assigned_driver ?? ''}
          onChange={(e) => onAssign(shipment, e.target.value)}
          className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2 py-2 text-xs"
        >
          <option value="">Libre (por escaneo)</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.full_name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <CopyTrackLink trackingCode={shipment.tracking_code} className="flex-1 py-2" />
        {hasProof && (
          <button
            onClick={() => onProof(shipment)}
            className="flex-1 rounded border-2 border-[var(--edr-yellow)] px-2 py-2 text-xs font-bold"
          >
            Ver prueba
          </button>
        )}
        <button
          onClick={() => onEdit(shipment)}
          className="flex-1 rounded border border-[var(--edr-border)] px-2 py-2 text-xs font-semibold"
        >
          Ver / editar
        </button>
        <button
          onClick={() => onPrint(shipment)}
          className="flex-1 rounded border border-[var(--edr-border)] px-2 py-2 text-xs font-semibold"
        >
          Imprimir
        </button>
        <button
          onClick={() => onDelete(shipment)}
          className="rounded border border-red-400 px-2 py-2 text-xs font-semibold text-red-200"
        >
          Eliminar
        </button>
      </div>
    </div>
  );
}
