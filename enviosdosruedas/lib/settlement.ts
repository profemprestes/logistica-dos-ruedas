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
  /** Hace falta para saber qué decir cuando el envío no trae nombre. */
  is_flex?: boolean | null;
  /**
   * Si esta entrega es una parada más de un envío con varias (paso 53).
   *
   * Importa para la plata: la primera entrega lleva el precio y las otras van
   * en cero, así el comercio paga un envío aunque el repartidor haya hecho dos
   * paradas. Sin esto, cada segunda entrega se contaba como "envío sin valor
   * cargado" y le decía al repartidor que le faltaba cobrar algo que no
   * existe.
   */
  parte_de?: number | null;
}

export interface DeliveryLog {
  /** uuid */
  id: string;
  event: 'entregado' | 'no_entregado' | 'retirado';
  amount_collected: number | null;
  happened_at: string;
  failure_reason: string | null;
  shipment: LogShipment | null;
  /**
   * Lo que se cobró DE VERDAD, si no fue lo que cargó el repartidor (paso 54).
   *
   * Va al lado y no encima de `amount_collected` a propósito: ese es el número
   * que él cargó al cerrar, a esa hora y con esa foto, y es un hecho. Pisarlo
   * dejaría la corrección indistinguible de haber cargado bien desde el
   * principio, y el día que haya una discusión de plata no quedaría rastro de
   * quién dijo qué.
   */
  cobrado_corregido?: number | null;
  correccion_nota?: string | null;
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
  /*
   * La corrección de la oficina manda sobre todo lo demás.
   *
   * El 20/08/2026 un envío salió con $ 65.230 a cobrar y en la puerta se
   * cobraron $ 36.900. El repartidor cerró con el monto que traía el envío, así
   * que la caja le pedía rendir $ 28.330 que nunca tuvo en la mano. Ver el
   * paso 54.
   */
  if (l.cobrado_corregido != null) return Number(l.cobrado_corregido);

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

/** Si a este movimiento la oficina le corrigió lo cobrado. */
export function fueCorregido(l: DeliveryLog): boolean {
  return l.cobrado_corregido != null;
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

/**
 * Si a este entregado le falta el precio de verdad.
 *
 * Cero no siempre es olvido. Una entrega que es parada de un envío con varias
 * (paso 53) vale cero POR DISEÑO: el precio entero está en la primera, porque
 * el comercio paga un envío aunque el repartidor haya hecho dos paradas.
 *
 * Contarlas le decía al repartidor "te falta cargar un valor" de algo que no le
 * falta, todos los viernes, hasta que el cartel deja de mirarse. Y ese es el
 * día en que un envío sin precio de verdad pasa de largo.
 */
export function sinPrecio(l: DeliveryLog): boolean {
  return !Number(l.shipment?.shipping_fee) && l.shipment?.parte_de == null;
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

  /**
   * Lo que le queda a la empresa por los envíos del día.
   *
   * Dos orígenes y conviene verlos separados, porque se mueven por razones
   * distintas: la comisión sube si suben las tarifas, y lo de Shippy sube sólo
   * si se hacen más envíos de ellos. Un mes con la misma facturación y menos
   * ganancia es casi siempre un cambio en la mezcla, no en los precios.
   */
  companyProfit: number;
  /** El 30% de los envíos normales. */
  profitComision: number;
  /** Lo fijo por cada envío de Shippy: ellos pagan más de lo que se paga. */
  profitShippy: number;
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
  const shippingMissing = delivered.filter(sinPrecio).length;

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

  /*
   * Y lo que le queda a la empresa, con las mismas dos reglas dadas vuelta.
   *
   * En los normales es la comisión: lo que se factura menos lo que se paga. En
   * los de Shippy NO es una resta sino un número fijo por envío, porque Shippy
   * paga por su lado y esa negociación no está en el sistema. Si mañana cambia
   * lo que pagan, hay que tocar `REGLAS.gananciaPorShippy` a mano — ninguna
   * otra cosa se va a dar cuenta.
   */
  const facturadoNormales = normales.reduce(
    (acc, l) => acc + Number(l.shipment?.shipping_fee ?? 0),
    0,
  );
  const profitComision = Math.round(facturadoNormales - earningsNormales);
  const profitShippy = deShippy.length * REGLAS.gananciaPorShippy;

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
    companyProfit: profitComision + profitShippy,
    profitComision,
    profitShippy,
  };
}

/**
 * Del 1 al último del mes en el que cae `day`.
 *
 * El día 0 del mes siguiente es el último del actual, y así no hay que saberse
 * cuáles tienen 30, cuáles 31 y qué pasa en febrero de un año bisiesto.
 */
export function monthRange(day: string) {
  const [a, m] = day.split('-').map(Number);
  const ultimo = new Date(a, m, 0).getDate();

  const desde = `${a}-${String(m).padStart(2, '0')}-01`;
  const hasta = `${a}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;

  return {
    from: new Date(`${desde}T00:00:00`).toISOString(),
    to: new Date(`${hasta}T23:59:59.999`).toISOString(),
    desde,
    hasta,
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

const DEL_ENVIO =
  'id, tracking_code, recipient_name, address_street, amount_to_collect, payment_mode, ' +
  'shipping_fee, client_name_raw, is_flex';

const LOG_BASE = 'id, event, amount_collected, happened_at, failure_reason';
const CORRECCION = 'cobrado_corregido, correccion_nota';

/** Campos que hay que pedirle a `delivery_logs` para que las cuentas cierren. */
export const LOG_SELECT = `${LOG_BASE}, ${CORRECCION}, shipment:shipment_id(${DEL_ENVIO}, parte_de)`;

/** El mismo pedido sin lo que agregan los pasos 53 y 54, por si no se corrieron. */
export const LOG_SELECT_SIN_PARTES = `${LOG_BASE}, shipment:shipment_id(${DEL_ENVIO})`;

/**
 * Trae movimientos sin romperse si el paso 53 todavía no se corrió.
 *
 * Los pasos de SQL se corren a mano, así que hay un rato en que `parte_de` no
 * existe. Y una consulta que nombra una columna inexistente NO devuelve la fila
 * sin ese campo: falla entera. En estas cuatro consultas eso no es "falta un
 * dato", es el cierre de caja en blanco — la pantalla donde se decide cuánta
 * plata rinde el repartidor.
 *
 * Se le pasa el armado de la consulta, no la consulta hecha, porque hay que
 * poder correrla dos veces con dos listas de campos distintas.
 */
export async function conLosMovimientos<T>(
  armar: (select: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const r = await armar(LOG_SELECT);

  // Falla entera si le falta CUALQUIERA de las columnas nuevas —`parte_de` del
  // paso 53, `cobrado_corregido` del 54—, así que se mira por las dos.
  const faltaAlguna =
    r.error != null && /parte_de|cobrado_corregido|correccion_nota/.test(r.error.message);

  const buena = faltaAlguna ? await armar(LOG_SELECT_SIN_PARTES) : r;

  return { data: (buena.data ?? null) as T | null, error: buena.error };
}

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
