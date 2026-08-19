import type { PaymentMode } from './format';

/**
 * Convierte el texto que mandan los comercios por WhatsApp en envíos.
 *
 * Reglas que aplica (sacadas de mensajes reales):
 *
 *  - Línea sola, corta y sin números  -> nombre del comercio.
 *  - Línea que empieza con RETIRA     -> dirección de retiro para las de abajo.
 *  - Línea que empieza con "-"        -> una entrega.
 *  - Dentro de una entrega, "RETIRA ... . ENTREGA EN ..." separa retiro de entrega.
 *
 * Plata (ojo que se parecen mucho y significan lo contrario):
 *  - COBRAR ENVIO $4600      -> el repartidor cobra $4600 en la puerta.
 *  - ENVIO $3000 (NO COBRAR) -> el envío vale $3000 pero no se cobra al destinatario.
 *  - ENVIO $4600 (cobrar al retirar) -> se le cobra al comercio al retirar.
 *  - COBRAR $55930           -> total mercadería + envío, hay que discriminarlo.
 *
 * Paréntesis:
 *  - (NO COBRAR) / (COBRAR AL RETIRAR) / (PAGADO) / (FLEX) -> instrucción.
 *  - (óxido nítrico x2, Gustavo 542235783553)              -> producto y contacto.
 */

export interface ParsedRow {
  tempId: string;
  isReminder: boolean;
  clientName: string;
  pickupAddress: string;
  pickupNotes: string;
  recipientName: string;
  recipientPhone: string;
  addressStreet: string;
  addressExtra: string;
  city: string;
  /** Día en que se reparte. Se elige al pegar la tanda y se puede mover fila por fila. */
  scheduledDate: string;
  deliveryWindow: string;
  productDetail: string;
  paymentMode: PaymentMode;
  shippingFee: number;
  merchandiseAmount: number;
  /** Lo que el repartidor cobra en la puerta. Por defecto, la mercadería. */
  amountToCollect: number;
  notes: string;
  warnings: string[];
  rawLine: string;
  /**
   * Punto confirmado a mano antes de guardar. En null lo busca el servidor.
   *
   * El parser nunca lo llena: sale de que alguien mire el mapa. Está acá para
   * que ese punto viaje junto al envío desde que se revisa la tanda hasta que
   * se guarda.
   */
  lat: number | null;
  lng: number | null;
}

/* ------------------------------------------------------------------ utils */

function parseAmount(raw: string): number {
  if (!raw) return 0;
  let s = raw.replace(/[$\s]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function clean(s: string): string {
  return s
    .replace(/[.,;\s-]+$/g, '')
    .replace(/^[.,;\s-]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const hhmm = (h: string, m?: string) => (m ? `${h}:${m}` : `${h}`);

/**
 * Saca las marcas de formato de WhatsApp: *negrita*, _cursiva_, ~tachado~, `mono`.
 *
 * ¡OJO CON EL ASTERISCO! Es la misma marca que se usa para las viñetas, y ahí
 * estaba el bug: `*TOYPIOLA*` (el comercio en negrita) entraba por la regla de
 * "línea que empieza con *" y se leía como una entrega. El comercio se perdía y
 * todo lo de abajo salía mal.
 *
 * Por eso se sacan sólo los asteriscos DE A PARES y sin espacio adentro, que es
 * como los escribe WhatsApp. Una viñeta de verdad ("* Alberti 2791") no tiene
 * el asterisco de cierre, así que no se toca y se sigue detectando como entrega.
 */
function sinFormatoWhatsapp(texto: string): string {
  return texto
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~([^~\n]+)~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

/* ---------------------------------------------------------------- regexes */

const RE_RANGE =
  /\b(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:a|A|hasta)\s*(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:hs|hrs|horas|h)\b/i;
const RE_BEFORE = /\bantes\s+(?:de\s+las\s+)?(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:hs|hrs|h)?\b/i;
const RE_AFTER =
  /\b(?:desde|despu[eé]s\s+de(?:\s+las)?|a\s+partir\s+de(?:\s+las)?)\s+(\d{1,2})(?:[:.\s](\d{2}))?\s*(?:hs|hrs|h)?\b/i;

const RE_COBRAR_ENVIO = /\bcobrar\s+env[ií]os?\s*:?\s*\$\s*([\d.,]+)/i;
const RE_ENVIO = /\benv[ií]os?\s*:?\s*\$\s*([\d.,]+)/i;
const RE_COBRAR = /\bcobrar\s*:?\s*\$\s*([\d.,]+)/i;

const RE_FLAG_NO_COBRAR = /\bno\s+cobrar\b|\bsin\s+cobro\b/i;
const RE_FLAG_AL_RETIRAR = /\bcobrar\s+al\s+retirar\b|\bcobra\s+al\s+retirar\b/i;
const RE_FLAG_PAGADO = /\b(pagado|abonado|ya\s+pag[oó])\b/i;
const RE_FLAG_FLEX = /\bflex\b/i;

/**
 * Un teléfono como lo escribe la gente: con espacios, guiones y paréntesis.
 *
 * El patrón viejo pedía los dígitos pegados, así que "Noelia +54 9 223
 * 634-6427" y "Diego 223 533 2554" no eran teléfonos para el sistema y el
 * contacto entero terminaba en el campo de producto. Nunca se cargó un
 * destinatario con nombre y teléfono desde una tanda pegada.
 *
 * Se acepta cualquier hilera de números con separadores en el medio y después
 * se cuentan los dígitos: eso es lo que decide si es un teléfono o el número
 * de una casa.
 */
const RE_TEL_CANDIDATO = /\+?\d[\d\s().-]{6,}\d/g;

/** Saca el teléfono de un texto y devuelve lo que queda: el nombre, casi siempre. */
function sacarTelefono(texto: string): { telefono: string; resto: string } {
  for (const m of texto.matchAll(RE_TEL_CANDIDATO)) {
    const digitos = m[0].replace(/\D/g, '');
    // Menos de ocho no es un teléfono; más de quince, tampoco.
    if (digitos.length < 8 || digitos.length > 15) continue;
    return { telefono: clean(m[0]), resto: clean(texto.replace(m[0], ' ')) };
  }
  return { telefono: '', resto: texto };
}

const tieneTelefono = (texto: string) => sacarTelefono(texto).telefono !== '';

/**
 * Calle + altura, con depto opcional pegado al final ("ESPAÑA 2155 5B").
 *
 * La barra contempla los departamentos dobles, comunes en los edificios
 * viejos: "BELGRANO 2875 5A/B" se partía en "BELGRANO 2875 5A" más una nota
 * suelta que decía "/B".
 *
 * EL PEDAZO DE LETRA DEL PRINCIPIO NO ES ADORNO. Antes se cortaba en el primer
 * número que apareciera, y "1 MAYO 1632" quedaba como calle "1" con "MAYO
 * 1632" tirado en las notas — la dirección de retiro de CATALINA INDUMENTARIA
 * era, literalmente, "1". Acá hay un montón de calles que empiezan con número:
 * 1 DE MAYO, 25 DE MAYO, 3 DE FEBRERO, 12 DE OCTUBRE. Pidiendo una letra antes
 * de la altura, el primer número pasa a ser parte del nombre de la calle y la
 * altura es la que viene después.
 */
const RE_ADDR_HEAD =
  /^(.*?[A-Za-zÁÉÍÓÚÜÑáéíóúüñ].*?\d{1,5}(?:\s+\d{1,3}\s*[A-Za-z](?:\s*\/\s*[A-Za-z])?\b)?)/;
const RE_DEPTO_TAIL = /\s(\d{1,3}\s*[A-Za-z](?:\s*\/\s*[A-Za-z])?)$/;
const RE_PISO_DTO = /\b((?:piso|p\.)\s*\w+(?:\s*(?:dto|dpto|depto)\.?\s*\w+)?|(?:dto|dpto|depto)\.?\s*\w+)\b/i;

let counter = 0;
const nextId = () => `row-${Date.now()}-${counter++}`;

/* --------------------------------------------------------- sub-extractors */

/** Saca el horario del texto y lo devuelve en formato legible. */
function takeWindow(text: string): { window: string; rest: string } {
  let m = text.match(RE_RANGE);
  if (m) return { window: `${hhmm(m[1], m[2])} a ${hhmm(m[3], m[4])} hs`, rest: text.replace(m[0], ' ') };

  m = text.match(RE_BEFORE);
  if (m) return { window: `antes de ${hhmm(m[1], m[2])} hs`, rest: text.replace(m[0], ' ') };

  m = text.match(RE_AFTER);
  if (m) return { window: `desde ${hhmm(m[1], m[2])} hs`, rest: text.replace(m[0], ' ') };

  return { window: '', rest: text };
}

/** Separa "ESPAÑA 2155 5B DR LOZA, RECETAS..." en dirección / depto / resto. */
function takeAddress(segment: string): { street: string; extra: string; rest: string } {
  const source = clean(segment);
  let extra = '';
  let street = source;
  let rest = '';

  const piso = source.match(RE_PISO_DTO);
  if (piso) {
    extra = clean(piso[0]);
    street = source.replace(piso[0], ' ');
  }

  const head = street.match(RE_ADDR_HEAD);
  if (head && head[1].trim()) {
    rest = clean(street.slice(head[0].length));
    street = clean(head[1]);

    /*
     * Esquinas. "CALLE 20 Y CALLE 491" se cortaba en el primer número y
     * quedaba como "CALLE 20", con "Y CALLE 491" tirado en las notas: la mitad
     * de la dirección afuera del renglón que lee el repartidor.
     *
     * En buena parte del partido no hay numeración, o es irregular, y la
     * dirección ES la esquina. Así que si lo que sigue empieza con "y" o "esq"
     * y parece otra calle —letras y números, sin comas ni frases— se vuelve a
     * pegar.
     */
    const esquina = rest.match(/^(?:y|esq\.?|esquina)\s+(.+)$/i);
    if (esquina && esquina[1].length <= 40 && /^[\wáéíóúñ\s.°º]+$/i.test(esquina[1])) {
      street = `${street} y ${clean(esquina[1])}`;
      rest = '';
    }
  } else {
    // Sin altura numérica: PLANTA YPF, ALDREY, CORREO OCA PASO E INDEPENDENCIA
    const parts = street.split(/[.,]/);
    street = clean(parts[0]);
    rest = clean(parts.slice(1).join(' '));
  }

  if (!extra) {
    const tail = street.match(RE_DEPTO_TAIL);
    if (tail) {
      extra = clean(tail[1]);
      street = clean(street.replace(RE_DEPTO_TAIL, ''));
    }
  }

  return { street, extra, rest };
}

/* -------------------------------------------------------------- principal */

/** Hoy en hora local. En UTC, de noche ya estaríamos en el día siguiente. */
function hoyLocal(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function parseWhatsappText(
  text: string,
  defaultCity = 'Mar del Plata',
  /** Para qué día es la tanda. Por defecto hoy. */
  scheduledDate = hoyLocal(),
): ParsedRow[] {
  /*
   * Las l\u00edneas se limpian TODAS DE UNA, antes de empezar a leerlas.
   *
   * Antes se limpiaba cada una en su turno, y as\u00ed no se pod\u00eda mirar la de
   * abajo \u2014 que es lo que hace falta para saber si una l\u00ednea es el nombre de
   * un comercio: la que sigue empieza con RETIRA.
   *
   * Se saca el formato de WhatsApp y el "[12/8, 09:14] Mat\u00edas: " que le pone
   * adelante un chat exportado. Sin eso, el corchete se lee como parte de la
   * direcci\u00f3n y el env\u00edo entra con "[12" de calle.
   */
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean)
    .map((l) => sinFormatoWhatsapp(l).replace(/^\[[^\]]+\]\s*[^:]{1,40}:\s*/, ''))
    .filter(Boolean);

  const rows: ParsedRow[] = [];
  let client = '';
  let pickupAddress = '';
  let pickupNotes = '';
  /**
   * FLEX declarado arriba, en la línea de RETIRA, y no en cada entrega.
   * Hay comercios que lo escriben una sola vez para toda la tanda.
   */
  let flexDelComercio = false;

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    const siguiente = lines[i + 1] ?? '';

    const isDeliveryLine = /^[-•*·]/.test(original);
    let line = original.replace(/^[-•*·]\s*/, '').trim();

    /* ---------- Nombre del comercio ----------
     *
     * NO ALCANZA CON "no tiene números". Esa era la regla, y por eso DROPIX3D
     * no se leía como comercio: el 3 del nombre lo descalificaba. Los dos
     * envíos de abajo terminaron colgados de CATALINA INDUMENTARIA, que era el
     * comercio anterior, y encima el nombre solo se guardó como un envío más
     * con dirección "DROPIX3". Un mensaje, tres cosas mal.
     *
     * Lo que descalifica a una línea no es tener un dígito: es tener un NÚMERO
     * SUELTO, que es lo que distingue una dirección ("1 MAYO 1632") de un
     * nombre con un número pegado ("DROPIX3D", "3D LAB"). El \b de los dos
     * lados es todo el truco.
     *
     * Y si la línea de abajo empieza con RETIRA, ésta es el comercio aunque
     * tenga números sueltos: ninguna dirección de entrega viene seguida de un
     * "RETIRA EN". Eso salva nombres como "MOTO 24".
     */
    const numeroSuelto = /\b\d{1,5}\b/.test(line);
    const abajoDiceRetira = /^\s*retira/i.test(siguiente);

    if (
      !isDeliveryLine &&
      !/\bretira/i.test(line) &&
      line.length <= 40 &&
      (!numeroSuelto || abajoDiceRetira)
    ) {
      client = clean(line.replace(/[:()]/g, ''));
      const previous = [...rows].reverse().find(
        (r) => r.clientName.toLowerCase() === client.toLowerCase() && r.pickupAddress
      );
      pickupAddress = previous?.pickupAddress ?? '';
      pickupNotes = previous?.pickupNotes ?? '';
      // Otro comercio, otra tanda: lo del anterior no se arrastra.
      flexDelComercio = false;
      continue;
    }

    // ---------- Línea de retiro suelta ----------
    if (!isDeliveryLine && /^retira/i.test(line)) {
      // "RETIRA EN INDEPENDENCIA 2684 (FLEX)": vale para todo lo que sigue.
      if (RE_FLAG_FLEX.test(line)) flexDelComercio = true;
      let rest = line.replace(/\(([^)]*flex[^)]*)\)/gi, ' ').replace(/^retira\s*/i, ' ');
      const w = takeWindow(rest);
      rest = w.rest.replace(/^\s*en\s+/i, ' ').replace(/\s+en\s+/i, ' ');
      const addr = takeAddress(rest);
      pickupAddress = [addr.street, addr.extra].filter(Boolean).join(' ');
      pickupNotes = [w.window ? `Retira ${w.window}` : '', addr.rest].filter(Boolean).join(' | ');
      continue;
    }

    // ---------- Línea de entrega ----------
    const warnings: string[] = [];

    /*
     * Cada paréntesis va a un lado distinto, y se miran de a uno.
     *
     * Antes se juntaban todos y lo que no fuera plata caía en "producto". Por
     * eso una instrucción como "(volver a rendir al terminar a Galicia 2166)"
     * terminaba mezclada con el contacto en un campo que el repartidor lee
     * como si fuera la descripción del paquete.
     */
    const flags: string[] = [];
    const contactos: string[] = [];
    const notasSueltas: string[] = [];

    line = line.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      const t = inner.trim();
      if (
        RE_FLAG_NO_COBRAR.test(t) ||
        RE_FLAG_AL_RETIRAR.test(t) ||
        RE_FLAG_PAGADO.test(t) ||
        RE_FLAG_FLEX.test(t)
      ) {
        flags.push(t);
      } else if (tieneTelefono(t)) {
        contactos.push(t);
      } else {
        notasSueltas.push(t);
      }
      return ' ';
    });

    const flagText = flags.join(' ');
    const isReminder = flexDelComercio || RE_FLAG_FLEX.test(flagText) || RE_FLAG_FLEX.test(line);
    if (isReminder) line = line.replace(/\bflex\b/gi, ' ');

    // Contacto del destinatario: el paréntesis que trae un teléfono.
    let recipientName = '';
    let recipientPhone = '';
    const productDetail = '';

    if (contactos.length) {
      const { telefono, resto } = sacarTelefono(contactos[0]);
      recipientPhone = telefono;
      // Lo que queda al sacarle el teléfono es el nombre, sin la coma que a
      // veces los separa: "Noelia, 223 634-6427".
      recipientName = clean(resto.replace(/[,;]/g, ' '));
      // Un segundo contacto no se pierde: va a las notas.
      notasSueltas.push(...contactos.slice(1));
    }

    // ¿Trae el retiro adentro de la misma línea?
    let deliveryPart = line;
    let lineHasPickup = false;
    if (/\bretira/i.test(line)) {
      lineHasPickup = true;
      const split = line.split(/\.\s*entrega(?:\s+en)?\s*|\bentrega\s+en\b/i);
      const pickupPart = split[0] ?? '';
      deliveryPart = split.slice(1).join(' ');

      let p = pickupPart.replace(/^\s*/, '');
      const pw = takeWindow(p);
      p = pw.rest.replace(/\bretira\b/i, ' ').replace(/^\s*en\s+/i, ' ').replace(/\s+en\s+/i, ' ');
      const addr = takeAddress(p);
      pickupAddress = [addr.street, addr.extra].filter(Boolean).join(' ') || pickupAddress;
      pickupNotes = [pw.window ? `Retira ${pw.window}` : '', addr.rest].filter(Boolean).join(' | ');

      if (!deliveryPart.trim()) {
        deliveryPart = pickupPart;
        warnings.push('No se pudo separar retiro de entrega: revisá las dos direcciones.');
      }
    } else {
      deliveryPart = deliveryPart.replace(/\bentrega\s+en\b/i, ' ');
    }

    // Horario de entrega
    const dw = takeWindow(deliveryPart);
    let deliveryWindow = dw.window;
    deliveryPart = dw.rest;

    // Si el único horario estaba junto al retiro, sirve igual para la entrega
    if (!deliveryWindow && lineHasPickup) {
      const m = pickupNotes.match(/Retira (.+?)(?: \||$)/);
      if (m) deliveryWindow = m[1];
    }

    // Plata
    let paymentMode: PaymentMode = 'no_cobrar';
    let shippingFee = 0;
    let merchandiseAmount = 0;

    const mCobrarEnvio = deliveryPart.match(RE_COBRAR_ENVIO);
    if (mCobrarEnvio) deliveryPart = deliveryPart.replace(mCobrarEnvio[0], ' ');

    const mEnvio = deliveryPart.match(RE_ENVIO);
    if (mEnvio) deliveryPart = deliveryPart.replace(mEnvio[0], ' ');

    const mCobrar = deliveryPart.match(RE_COBRAR);
    if (mCobrar) deliveryPart = deliveryPart.replace(mCobrar[0], ' ');

    if (mCobrarEnvio) {
      paymentMode = 'cobrar_destinatario';
      shippingFee = parseAmount(mCobrarEnvio[1]);
    } else if (mCobrar) {
      // "COBRAR $55930" es lo que hay que cobrar EN LA PUERTA, tal cual.
      // El valor del envío va aparte y se descuenta después, al rendir.
      paymentMode = 'cobrar_destinatario';
      merchandiseAmount = parseAmount(mCobrar[1]);
      shippingFee = mEnvio ? parseAmount(mEnvio[1]) : 0;
      if (!mEnvio) warnings.push('No aclara cuánto es de envío: cargalo para el cierre de caja.');
    } else if (mEnvio) {
      shippingFee = parseAmount(mEnvio[1]);
      if (!flagText) warnings.push('Dice ENVIO pero no aclara si se cobra. Quedó como "no cobrar".');
    } else {
      warnings.push('No se detectó ningún monto.');
    }

    if (RE_FLAG_NO_COBRAR.test(flagText)) paymentMode = 'no_cobrar';
    else if (RE_FLAG_AL_RETIRAR.test(flagText)) paymentMode = 'cobrar_al_retirar';
    else if (RE_FLAG_PAGADO.test(flagText)) paymentMode = 'pagado';

    // Dirección de entrega
    const addr = takeAddress(deliveryPart);
    if (!addr.street) warnings.push('No se detectó la dirección de entrega.');
    if (!client) warnings.push('Sin comercio asignado.');
    if (!pickupAddress && !isReminder) warnings.push('Sin dirección de retiro.');

    // Dos paradas separadas por "/": el precio va en la primera
    const stops = addr.street.includes('/')
      ? addr.street.split('/').map(clean).filter(Boolean)
      : [addr.street];

    stops.forEach((stop, index) => {
      const second = index > 0;
      rows.push({
        tempId: nextId(),
        isReminder,
        clientName: client,
        pickupAddress,
        pickupNotes,
        recipientName: recipientName || 'Sin nombre',
        recipientPhone,
        addressStreet: stop,
        addressExtra: second ? '' : addr.extra,
        city: defaultCity,
        scheduledDate,
        deliveryWindow,
        productDetail,
        paymentMode: second ? 'no_cobrar' : paymentMode,
        shippingFee: second ? 0 : shippingFee,
        merchandiseAmount: second ? 0 : merchandiseAmount,
        /*
         * Lo que el repartidor cobra en la puerta.
         *
         * Casi siempre es la mercadería —"COBRAR $55930" ya trae el envío
         * adentro y se discrimina al rendir—, pero cuando el mensaje dice
         * "COBRAR ENVIO $4600" no hay mercadería: lo que se cobra ES el envío.
         *
         * Antes esto miraba sólo la mercadería, así que esos envíos entraban
         * con "a cobrar $0": el repartidor no sabía que tenía que cobrar y en
         * el panel no aparecían en la columna de plata. El dato estaba escrito
         * en el mensaje y se perdía en el camino.
         */
        amountToCollect:
          second || paymentMode !== 'cobrar_destinatario'
            ? 0
            : merchandiseAmount || shippingFee,
        notes: [
          addr.rest,
          // Las instrucciones entre paréntesis: "volver a rendir al terminar",
          // "retira ropa de cambio". Son para el repartidor y sin esto se
          // perdían adentro del campo de producto.
          second ? '' : notasSueltas.join(' | '),
          stops.length > 1 ? `Envío de 2 paradas (${stops.join(' + ')}), precio conjunto.` : '',
          isReminder ? 'RECORDATORIO FLEX: se hace por la app de Mercado Libre.' : '',
        ]
          .filter(Boolean)
          .join(' | '),
        warnings: [...warnings],
        rawLine: original,
        lat: null,
        lng: null,
      });
    });
  }

  return rows;
}
