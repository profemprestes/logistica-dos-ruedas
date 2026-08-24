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
  /**
   * Hasta qué hora se puede retirar ESTE envío, si es la excepción.
   *
   * Vacío casi siempre: lo normal es que mande el horario del comercio. Ver
   * `horarioDeRetiro` en `lib/franja.ts`, que decide cuál de los dos gana.
   */
  pickup_window?: string | null;
  /**
   * El comercio donde se retira, con su horario.
   *
   * Viene pegado en la consulta de la hoja de ruta
   * (`comercio:client_id(pickup_window, pickup_window_sabado)`), así que un
   * envío traído de otra forma puede no tenerlo: por eso es opcional.
   *
   * Es el horario que manda cuando el envío no trae el suyo. Ver
   * `horarioDeRetiro` en `lib/franja.ts`, que decide cuál de los dos gana.
   */
  comercio?: { pickup_window?: string | null; pickup_window_sabado?: string | null } | null;
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
  /**
   * De quién va a ser el paquete cuando lo retiren, sin dárselo todavía.
   *
   * NO ES `assigned_driver`, y la diferencia es toda la gracia. Asignar mete el
   * envío en la hoja de ruta; preasignar no lo muestra en ningún lado y sólo lo
   * mira el escáner (paso 38). Sirve el día que dos repartidores van al mismo
   * comercio: cada uno se lleva lo suyo, y si agarra el del otro el sistema lo
   * frena y le dice de quién es.
   */
  preasignado_a: string | null;
  scheduled_date: string;
  created_at: string;
  /**
   * Punto de entrega, buscado a partir de la dirección al cargar el envío.
   * Queda en null cuando el buscador no estuvo seguro: entonces no se dibuja
   * mapa, que es mejor que dibujarlo en la cuadra equivocada.
   */
  lat?: number | null;
  lng?: number | null;
  /**
   * Los dos lados de una reprogramación (paso 31).
   *
   * `reintento_de` apunta al intento fallido del que nació este envío;
   * `reprogramado_en`, al envío nuevo que lo reemplaza. Que el segundo esté en
   * null es lo que distingue "no se entregó y se está viendo" de "no se
   * entregó y nadie hizo nada": de ahí sale uno de los avisos del panel.
   */
  reintento_de?: number | null;
  reprogramado_en?: number | null;
  /**
   * Si esta entrega es una parada más de un envío con varias (paso 53), el id
   * de la primera. Null en un envío común.
   *
   * La primera —la cabeza— es la que lleva el precio; las otras van en cero. Se
   * usó eso y no un precio repartido porque el comercio paga UN envío: si cada
   * parada tuviera su parte, la suma del día contaría dos y el cierre de caja
   * cobraría de más. Ver `lib/entregas.ts`.
   */
  parte_de?: number | null;
  driver?: { full_name: string } | null;
  /**
   * El nombre del que lo tiene preasignado, cuando la consulta lo pide.
   *
   * Va aparte de `driver` porque son dos cosas distintas: `driver` lo tiene en
   * la hoja de ruta y éste todavía no. Los avisos del panel necesitan
   * distinguirlos para no decir "asignado" de algo que no lo está.
   */
  preasignado?: { full_name: string } | null;
}

/**
 * La hora de Mar del Plata, dé donde dé.
 *
 * DOS PROBLEMAS DISTINTOS, y hay que resolver los dos.
 *
 * El primero es el formato: `toLocaleString('es-AR')` no devuelve lo mismo en
 * todos lados —Safari del iPhone mete otro espacio antes del "p. m."— y estas
 * pantallas se dibujan en el servidor y se vuelven a dibujar en el celular de
 * quien abre el link. Si los dos textos no salen idénticos, React tira todo.
 *
 * El segundo es la zona horaria, y es el que de verdad muestra datos falsos:
 * el servidor corre en UTC, así que una entrega de las 21:34 salía impresa
 * como "15/08 00:34" en el HTML que ve el destinatario, tres horas adelante y
 * un día equivocado. Se arreglaba solo cuando el navegador re-dibujaba, pero
 * el primer vistazo —y lo que lee un buscador o la vista previa de WhatsApp—
 * era la hora de Londres.
 *
 * Por eso el desfasaje va escrito acá y las partes se leen con `getUTC*`: la
 * cuenta da igual en Vercel, en esta computadora y en cualquier teléfono.
 *
 * Argentina está en UTC-3 todo el año: no se cambia la hora desde 2009. El día
 * que vuelva el horario de verano, se cambia este número.
 */
const HORAS_ARGENTINA = -3;

function enArgentina(iso: string | Date): Date {
  const t = (iso instanceof Date ? iso : new Date(iso)).getTime();
  return new Date(t + HORAS_ARGENTINA * 3_600_000);
}

const dosCifras = (n: number) => String(n).padStart(2, '0');

/** "14/08/2026 21:34" */
export function fechaHoraAR(iso: string | Date): string {
  const d = enArgentina(iso);
  return (
    `${dosCifras(d.getUTCDate())}/${dosCifras(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ` +
    `${dosCifras(d.getUTCHours())}:${dosCifras(d.getUTCMinutes())}`
  );
}

/** "13:54" */
export function horaAR(iso: string | Date): string {
  const d = enArgentina(iso);
  return `${dosCifras(d.getUTCHours())}:${dosCifras(d.getUTCMinutes())}`;
}

/** "14/08" */
export function diaAR(iso: string | Date): string {
  const d = enArgentina(iso);
  return `${dosCifras(d.getUTCDate())}/${dosCifras(d.getUTCMonth() + 1)}`;
}

/** Qué hora del día es, con los minutos como decimales: 14:30 → 14.5. */
export function horaDelDiaAR(ahora: Date = new Date()): number {
  const d = enArgentina(ahora);
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** El día de hoy en Mar del Plata, en formato AAAA-MM-DD. */
export function hoyAR(ahora: Date = new Date()): string {
  return enArgentina(ahora).toISOString().slice(0, 10);
}

const DIAS_AR = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/**
 * Qué día de la semana es en Mar del Plata. 0 domingo … 6 sábado.
 *
 * Va con la hora de Argentina y no con la del servidor: en Vercel son las 00:30
 * del sábado cuando acá siguen siendo las 21:30 del viernes, y el horario de
 * retiro del sábado empezaría a regir seis horas antes de tiempo.
 */
export function diaDeLaSemanaAR(ahora: Date = new Date()): number {
  return enArgentina(ahora).getUTCDay();
}

/** Si hoy es sábado en Mar del Plata. */
export function esSabadoAR(ahora: Date = new Date()): boolean {
  return diaDeLaSemanaAR(ahora) === 6;
}

/** "viernes 14/08" */
export function diaDeHoyAR(ahora: Date = new Date()): string {
  const d = enArgentina(ahora);
  return `${DIAS_AR[d.getUTCDay()]} ${dosCifras(d.getUTCDate())}/${dosCifras(d.getUTCMonth() + 1)}`;
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

/**
 * Cómo se nombra al destinatario cuando no hay nombre.
 *
 * EL PROBLEMA. De 63 envíos, 40 dicen "Sin nombre", y 38 de ésos son Flex. En
 * un Flex el nombre no suele faltar por descuido: los datos de entrega viven
 * en la app de Mercado Libre y el repartidor los lee de ahí. "Sin nombre" hace
 * que un envío bien cargado parezca a medias, y el comercio pregunta por un
 * dato que nunca existió.
 *
 * En los que no son Flex, cuando no vino el nombre, el dato igual está: viene
 * escrito en el sobre o en el papel pegado al paquete. Decir eso es una
 * instrucción; decir "Sin nombre" es un agujero.
 *
 * SE RESUELVE AL MOSTRAR Y NO EN LA BASE. Lo guardado no se toca: son 40
 * envíos ya cerrados y reescribirlos sería cambiar el historial para arreglar
 * un cartel. Además el parser va a seguir guardando "Sin nombre" cuando el
 * WhatsApp no traiga ninguno, y así esa fila también queda bien contada.
 */
/**
 * Lo que en el campo "nombre" en realidad quiere decir que no hay nombre.
 *
 * Las dos últimas ya están escritas a mano en la base: alguien de la oficina
 * puso "Lo dice el sobre" en vez del nombre, que es exactamente esto. Se las
 * reconoce para que la columna se lea igual en todas las filas y no queden
 * tres formas de decir lo mismo.
 */
/**
 * Lo que se escribió alguna vez en el lugar del nombre sin ser un nombre.
 *
 * Dos familias. Los rellenos de "acá no hay dato" —"Sin nombre", "s/n", un
 * guión— y las frases que dicen dónde está el dato de verdad: "lo dice el
 * paquete", "está en el sobre". Las segundas las escribió una persona a mano,
 * cada vez con palabras distintas, y todas quieren decir lo mismo.
 *
 * Se reconocen para poder mostrar SIEMPRE el mismo cartel, sin importar cómo se
 * escribió ese día. Y se reconocen al MOSTRAR, no al guardar: las filas viejas
 * ya tienen el texto adentro y no se van a reescribir.
 *
 * Un nombre que empieza parecido —"Sin Nombre Apellido"— no entra: la expresión
 * exige que el renglón sea ESO y nada más.
 */
const SIN_NOMBRE =
  /^\s*(sin (nombre|datos|nada)|s\/n|n\/a|-{1,3}|(lo\s+)?(dice|est[áa]|va|figura)\s+(en\s+)?(el|la|lo)?\s*(sobre|papel|paquete|bolsa|caja)(\s*\/\s*(sobre|papel|paquete|bolsa|caja))*)\s*$/i;

export const NOMBRE_FLEX = 'Datos de entrega en la aplicación Envíos Flex';
export const NOMBRE_EN_EL_PAQUETE = 'Lo dice el sobre/papel';

export function nombreDelDestinatario(
  shipment: Pick<Shipment, 'recipient_name'> & { is_flex?: boolean | null },
): string {
  /*
   * EL NOMBRE GANA SIEMPRE, sea Flex o no.
   *
   * Los carteles de abajo son para cuando no hay nombre, no en lugar del
   * nombre. Un Flex puede venir con el destinatario cargado —pasa cuando el
   * comercio lo pasa por WhatsApp igual— y tapar ese dato con un cartel sería
   * esconder algo que alguien se tomó el trabajo de escribir.
   */
  const nombre = (shipment.recipient_name ?? '').trim();
  if (nombre && !SIN_NOMBRE.test(nombre)) return nombre;

  // No hay nombre. Qué decir en su lugar depende de por qué no lo hay: en un
  // Flex está en la app de ellos; en el resto, escrito en el paquete.
  return shipment.is_flex ? NOMBRE_FLEX : NOMBRE_EN_EL_PAQUETE;
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

/**
 * Cómo se llaman los estados EN EL PANEL.
 *
 * En la base no existe un estado "no entregado": un envío que no se pudo
 * entregar queda en `pendiente_entrega`, esperando que se lo vuelva a
 * intentar. Ese nombre describe bien la casilla y mal lo que pasó, y el que
 * mira el listado quiere ver lo que pasó.
 *
 * Vive acá y no en la pantalla para que la tabla y la tarjeta del celular no
 * puedan terminar llamándolo distinto.
 */
export const ETIQUETA_ESTADO: Record<ShipmentStatus, string> = {
  ...STATUS_LABEL,
  pendiente_entrega: 'No entregado',
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

export interface MarcaMapa {
  color: string;
  /** Lo que va dibujado adentro del punto. Vacío para los pendientes. */
  simbolo: string;
  /** Color del símbolo: sobre amarillo, el blanco no se lee. */
  colorTexto: string;
  /** Cómo se llama ese grupo en la referencia del mapa. */
  grupo: string;
}

/**
 * Cómo se dibuja un envío en el mapa.
 *
 * Tres grupos y no siete estados. En un mapa lo que se mira de un vistazo es
 * qué falta hacer, no en qué casilla exacta está cada envío: el detalle está
 * en la tabla y en el globito de cada punto.
 *
 *   amarillo         todo lo que todavía hay que entregar
 *   verde con tilde  entregado
 *   rojo con equis   no se pudo entregar
 *
 * El cancelado va en gris y aparte: no es ninguna de las tres cosas, ya no se
 * hace. Pintarlo de rojo lo confundiría con un intento fallido, que es un
 * envío que todavía se puede salvar.
 */
export function marcaDeEstado(status: ShipmentStatus): MarcaMapa {
  if (status === 'entregado') {
    return { color: '#059669', simbolo: '✓', colorTexto: '#ffffff', grupo: 'Entregado' };
  }
  if (status === 'pendiente_entrega') {
    return { color: '#dc2626', simbolo: '✕', colorTexto: '#ffffff', grupo: 'No entregado' };
  }
  if (status === 'cancelado') {
    return { color: '#737373', simbolo: '–', colorTexto: '#ffffff', grupo: 'Cancelado' };
  }
  return { color: '#facc15', simbolo: '', colorTexto: '#111827', grupo: 'Pendiente de entrega' };
}

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
