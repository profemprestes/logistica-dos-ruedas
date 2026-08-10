/**
 * Cuentas del cierre de caja.
 *
 * Vive acá y no en cada pantalla para que el "tenés que rendir" que ve el
 * repartidor en su celular y el "efectivo a rendir" que ve el admin en la
 * liquidación salgan SIEMPRE del mismo cálculo. Si se calculan por separado,
 * tarde o temprano dan distinto y alguien discute plata con el otro.
 */
import type { PaymentMode } from '@/lib/format';

export interface LogShipment {
  id: number;
  tracking_code: string;
  recipient_name: string;
  address_street: string;
  amount_to_collect: number;
  payment_mode: PaymentMode;
  shipping_fee: number;
  client_name_raw: string | null;
}

export interface DeliveryLog {
  /** uuid */
  id: string;
  event: 'entregado' | 'no_entregado' | 'retirado';
  amount_collected: number | null;
  happened_at: string;
  failure_reason: string | null;
  shipment: LogShipment | null;
}

/**
 * Efectivo que le entró al repartidor en un movimiento.
 *
 * El monto guardado manda. Cuando viene en null se deduce del envío, que es lo
 * que ya se hacía con las entregas: `scan_and_assign` registra el retiro pero
 * no llena `amount_collected`, así que sin esta cuenta la plata cobrada al
 * comercio al retirar nunca aparecía en la rendición y el día cerraba corto.
 */
export function logCash(l: DeliveryLog): number {
  if (l.event === 'entregado') {
    return Number(l.amount_collected ?? l.shipment?.amount_to_collect ?? 0);
  }

  if (l.event === 'retirado') {
    if (l.amount_collected !== null) return Number(l.amount_collected);
    return l.shipment?.payment_mode === 'cobrar_al_retirar'
      ? Number(l.shipment.shipping_fee ?? 0)
      : 0;
  }

  return 0; // no entregado: no cobró nada
}

export interface DaySummary {
  delivered: DeliveryLog[];
  failed: DeliveryLog[];
  /** Retiros en los que le cobró al comercio (modo "cobrar al retirar"). */
  pickups: DeliveryLog[];
  cashFromDeliveries: number;
  cashFromPickups: number;
  /** Lo que tiene que rendir al final del día. */
  cashTotal: number;

  /** Suma del valor de los envíos entregados, SIN descontar comisión. */
  shippingTotal: number;
  /** Cuántos entregados todavía no tienen cargado el valor del envío. */
  shippingMissing: number;
}

export function summarizeLogs(logs: DeliveryLog[]): DaySummary {
  const delivered = logs.filter((l) => l.event === 'entregado');
  const failed = logs.filter((l) => l.event === 'no_entregado');

  // "Cobrar al retirar": el repartidor le cobra al comercio cuando retira,
  // así que esa plata también entra en la rendición del día.
  const pickups = logs.filter((l) => l.event === 'retirado' && logCash(l) > 0);

  const cashFromDeliveries = delivered.reduce((acc, l) => acc + logCash(l), 0);
  const cashFromPickups = pickups.reduce((acc, l) => acc + logCash(l), 0);

  // Valor de los envíos hechos, sin tocar comisiones: eso lo ajusta el admin
  // a mano en el cierre de caja.
  const shippingTotal = delivered.reduce(
    (acc, l) => acc + Number(l.shipment?.shipping_fee ?? 0),
    0,
  );
  const shippingMissing = delivered.filter((l) => !Number(l.shipment?.shipping_fee)).length;

  return {
    delivered,
    failed,
    pickups,
    cashFromDeliveries,
    cashFromPickups,
    cashTotal: cashFromDeliveries + cashFromPickups,
    shippingTotal,
    shippingMissing,
  };
}

/** Lunes a domingo de la semana en la que cae `day`. */
export function weekRange(day: string) {
  const d = new Date(`${day}T12:00:00`);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  const lunes = new Date(d);
  lunes.setDate(d.getDate() - dow);
  const domingo = new Date(lunes);
  domingo.setDate(lunes.getDate() + 6);

  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return {
    from: new Date(`${iso(lunes)}T00:00:00`).toISOString(),
    to: new Date(`${iso(domingo)}T23:59:59.999`).toISOString(),
    desde: iso(lunes),
    hasta: iso(domingo),
  };
}

/** Campos que hay que pedirle a `delivery_logs` para que las cuentas cierren. */
export const LOG_SELECT =
  'id, event, amount_collected, happened_at, failure_reason, ' +
  'shipment:shipment_id(id, tracking_code, recipient_name, address_street, amount_to_collect, payment_mode, shipping_fee, client_name_raw)';

/**
 * El día va de 00:00 a 23:59 en hora local, no en UTC: si no, las entregas de
 * la tarde caen en el día siguiente.
 */
export function dayRange(day: string) {
  return {
    from: new Date(`${day}T00:00:00`).toISOString(),
    to: new Date(`${day}T23:59:59.999`).toISOString(),
  };
}

/** Hoy en formato `YYYY-MM-DD`, en hora local. */
export function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
