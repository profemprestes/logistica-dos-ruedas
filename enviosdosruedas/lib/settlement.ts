/**
 * Cuentas del cierre de caja.
 *
 * Vive acá y no en cada pantalla para que el "tenés que rendir" que ve el
 * repartidor en su celular y el "efectivo a rendir" que ve el admin en la
 * liquidación salgan SIEMPRE del mismo cálculo. Si se calculan por separado,
 * tarde o temprano dan distinto y alguien discute plata con el otro.
 */
import type { PaymentMode } from '@/lib/format';
// Las reglas de plata viven en un solo lugar: si la comisión cambia, cambia
// para el cierre de caja y para los resúmenes a la vez. Que dos pantallas del
// mismo sistema digan cosas distintas sobre la misma plata es peor que
// cualquier error de cuenta.
import { REGLAS, esShippy } from '@/lib/resumen';

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

/**
 * Lo que le queda al repartidor por ESE envío.
 *
 * Está separada para que el detalle envío por envío y el total del día salgan
 * de la misma cuenta. Si el renglón de la lista se calculara aparte, algún día
 * la suma de la lista no iba a dar el total de arriba — y ese es exactamente el
 * momento en que se deja de confiar en la pantalla.
 *
 *   · Envío normal: el 70%. El 30% es la comisión de la empresa.
 *   · Envío de Shippy: entero, sin comisión. A la empresa Shippy le paga
 *     aparte y ahí está la ganancia; descontarle el 30% al repartidor sería
 *     cobrarle una comisión que ya está cobrada del otro lado.
 */
export function pagoDelEnvio(l: DeliveryLog): number {
  const valor = Number(l.shipment?.shipping_fee ?? 0);

  if (esShippy(l.shipment?.client_name_raw ?? '')) {
    // Sin valor cargado se usa el de la regla: con Shippy está acordado.
    return valor || REGLAS.envioShippyPorDefecto;
  }

  // Un envío normal sin valor suma cero a propósito: no hay nada acordado que
  // suponer, y que se note es mejor que inventar un precio.
  return Math.round(valor * (1 - REGLAS.comision));
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

  /**
   * Lo que hay que pagarle al repartidor por los envíos del día.
   *
   * Sale de las mismas `REGLAS` que usan los resúmenes, y eso es todo el
   * punto: hasta hoy este número se escribía a mano en el cierre de caja
   * mientras los resúmenes lo calculaban solos, así que dos pantallas del
   * mismo sistema podían decir cosas distintas sobre la misma plata.
   */
  driverEarnings: number;
  /** Los normales: el 70%, ya descontada la comisión. */
  earningsNormales: number;
  /** Los de Shippy: el envío entero, sin comisión. */
  earningsShippy: number;
  /** Cuántos de Shippy hubo, para poder revisar la cuenta de un vistazo. */
  countShippy: number;
}

export function summarizeLogs(logs: DeliveryLog[]): DaySummary {
  const delivered = logs.filter((l) => l.event === 'entregado');

  // Un envío que se cerró como no entregado y después se corrigió deja los DOS
  // movimientos en la base (el historial no se toca). Para las cuentas del día
  // vale el final: si terminó entregado, no cuenta como fallido.
  const entregados = new Set(delivered.map((l) => l.shipment?.id));
  const failed = logs.filter(
    (l) => l.event === 'no_entregado' && !entregados.has(l.shipment?.id),
  );

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

  /*
   * LO QUE HAY QUE PAGARLE, con las mismas reglas que los resúmenes.
   *
   * Dos tarifas distintas y no se pueden mezclar:
   *
   *   · Un envío normal se paga al 70%: el 30% es la comisión de la empresa.
   *   · Uno de Shippy se paga ENTERO, sin comisión. A la empresa Shippy le
   *     paga aparte, y esa diferencia es la ganancia. Descontarle el 30% a
   *     estos sería cobrarle al repartidor una comisión que ya está cobrada
   *     del otro lado.
   *
   * Cuando un envío de Shippy viene sin valor cargado se usa el de la regla,
   * que es lo que se acordó con ellos. Para los normales no se inventa nada:
   * sin valor, ese envío suma cero y `shippingMissing` lo deja a la vista.
   */
  const deShippy = delivered.filter((l) => esShippy(l.shipment?.client_name_raw ?? ''));
  const normales = delivered.filter((l) => !esShippy(l.shipment?.client_name_raw ?? ''));

  // Los dos totales salen de sumar `pagoDelEnvio`, la misma que muestra cada
  // renglón de la lista: así la suma de la lista SIEMPRE da el total.
  const earningsShippy = deShippy.reduce((acc, l) => acc + pagoDelEnvio(l), 0);
  const earningsNormales = normales.reduce((acc, l) => acc + pagoDelEnvio(l), 0);

  return {
    delivered,
    failed,
    pickups,
    cashFromDeliveries,
    cashFromPickups,
    cashTotal: cashFromDeliveries + cashFromPickups,
    shippingTotal,
    shippingMissing,
    driverEarnings: earningsNormales + earningsShippy,
    earningsNormales,
    earningsShippy,
    countShippy: deShippy.length,
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

/**
 * Un rango cualquiera, de la mañana del primer día a la noche del último.
 * Si vienen al revés los da vuelta: elegir "del 20 al 10" es un error de dedo,
 * no un pedido de que no aparezca nada.
 */
export function customRange(desde: string, hasta: string) {
  const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
  return {
    from: new Date(`${a}T00:00:00`).toISOString(),
    to: new Date(`${b}T23:59:59.999`).toISOString(),
    desde: a,
    hasta: b,
  };
}

/** Hoy más `dias` (negativo para atrás), en formato `YYYY-MM-DD` y hora local. */
export function dayShift(day: string, dias: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Hoy en formato `YYYY-MM-DD`, en hora local. */
export function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
