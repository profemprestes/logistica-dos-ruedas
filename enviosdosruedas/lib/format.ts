export type PaymentMode =
  | 'cobrar_destinatario'
  | 'pagado'
  | 'no_cobrar'
  | 'cobrar_al_retirar';

export type ShipmentStatus =
  | 'creado'
  | 'pendiente_retiro'
  | 'retirado'
  | 'en_camino'
  | 'entregado'
  | 'pendiente_entrega'
  | 'cancelado';

export interface Shipment {
  id: number;
  tracking_code: string;
  status: ShipmentStatus;
  client_id: number | null;
  client_name_raw: string | null;
  pickup_address: string | null;
  pickup_notes: string | null;
  recipient_name: string;
  recipient_phone: string | null;
  address_street: string;
  address_extra: string | null;
  city: string;
  notes: string | null;
  delivery_window: string | null;
  product_detail: string | null;
  payment_mode: PaymentMode;
  /** Envio de Mercado Libre Flex: se cierra en la app de ellos, no en esta. */
  is_flex?: boolean | null;
  shipping_fee: number;
  merchandise_amount: number;
  amount_to_collect: number;
  assigned_driver: string | null;
  scheduled_date: string;
  created_at: string;
  driver?: { full_name: string } | null;
}

/** Muestra los montos como $ 25.000 */
export function money(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  return n.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });
}

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  creado: 'Creado',
  pendiente_retiro: 'Pendiente de retiro',
  retirado: 'Retirado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  pendiente_entrega: 'Pendiente de entrega',
  cancelado: 'Cancelado',
};

/** Clases de Tailwind para el chip de estado de cada fila */
export const STATUS_CLASS: Record<ShipmentStatus, string> = {
  creado: 'bg-neutral-100 text-neutral-700 ring-neutral-300',
  pendiente_retiro: 'bg-amber-50 text-amber-800 ring-amber-300',
  retirado: 'bg-sky-50 text-sky-800 ring-sky-300',
  en_camino: 'bg-blue-50 text-blue-800 ring-blue-300',
  entregado: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  pendiente_entrega: 'bg-orange-50 text-orange-900 ring-orange-400',
  cancelado: 'bg-red-50 text-red-800 ring-red-300',
};

/**
 * Plata que toca el repartidor en cada envío.
 *
 *  - atPickup:   se la cobra AL COMERCIO cuando retira (modo "cobrar al retirar").
 *  - atDelivery: se la cobra AL DESTINATARIO en la puerta.
 *  - total:      el efectivo que el repartidor tiene que rendir por ese envío.
 */
export interface CashBreakdown {
  atPickup: number;
  atDelivery: number;
  total: number;
}

/** Para formularios y filas parseadas, donde todavía no hay `amount_to_collect`. */
export function cashBreakdown(
  paymentMode: PaymentMode,
  shippingFee: number | null | undefined,
  merchandiseAmount: number | null | undefined,
): CashBreakdown {
  const fee = Number(shippingFee ?? 0);
  const goods = Number(merchandiseAmount ?? 0);
  // Al retirar se cobra el envío: la mercadería la paga el comercio, no el repartidor.
  const atPickup = paymentMode === 'cobrar_al_retirar' ? fee : 0;
  // Por defecto se cobra la mercadería: en la mayoría de los comercios el envío
  // ya viene incluido en ese número y se descuenta después, al rendir.
  const atDelivery = paymentMode === 'cobrar_destinatario' ? goods : 0;
  return { atPickup, atDelivery, total: atPickup + atDelivery };
}

/** Para envíos ya guardados: la cobranza en la puerta la manda la base. */
export function shipmentCash(s: Shipment): CashBreakdown {
  const atPickup = s.payment_mode === 'cobrar_al_retirar' ? Number(s.shipping_fee ?? 0) : 0;
  const atDelivery = s.payment_mode === 'cobrar_destinatario' ? Number(s.amount_to_collect ?? 0) : 0;
  return { atPickup, atDelivery, total: atPickup + atDelivery };
}

export const PAYMENT_LABEL: Record<PaymentMode, string> = {
  cobrar_destinatario: 'Cobrar al destinatario',
  pagado: 'Pagado',
  no_cobrar: 'No cobrar',
  cobrar_al_retirar: 'Cobrar al retirar',
};
