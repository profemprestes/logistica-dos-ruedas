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

const RE_PHONE = /\b(?:\+?54)?\s?(?:9)?\s?\d{8,13}\b/;
/** Calle + altura, con depto opcional pegado al final ("ESPAÑA 2155 5B") */
const RE_ADDR_HEAD = /^(.*?\d{1,5}(?:\s+\d{1,3}\s*[A-Za-z]\b)?)/;
const RE_DEPTO_TAIL = /\s(\d{1,3}\s*[A-Za-z])$/;
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

export function parseWhatsappText(text: string, defaultCity = 'Mar del Plata'): ParsedRow[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\u00a0/g, ' ').trim())
    .filter(Boolean);

  const rows: ParsedRow[] = [];
  let client = '';
  let pickupAddress = '';
  let pickupNotes = '';

  for (const original of lines) {
    const isDeliveryLine = /^[-•*·]/.test(original);
    let line = original.replace(/^[-•*·]\s*/, '').trim();

    // ---------- Nombre del comercio ----------
    if (!isDeliveryLine && !/\bretira/i.test(line) && !/\d/.test(line) && line.length <= 40) {
      client = clean(line.replace(/[:()]/g, ''));
      const previous = [...rows].reverse().find(
        (r) => r.clientName.toLowerCase() === client.toLowerCase() && r.pickupAddress
      );
      pickupAddress = previous?.pickupAddress ?? '';
      pickupNotes = previous?.pickupNotes ?? '';
      continue;
    }

    // ---------- Línea de retiro suelta ----------
    if (!isDeliveryLine && /^retira/i.test(line)) {
      let rest = line.replace(/^retira\s*/i, ' ');
      const w = takeWindow(rest);
      rest = w.rest.replace(/^\s*en\s+/i, ' ').replace(/\s+en\s+/i, ' ');
      const addr = takeAddress(rest);
      pickupAddress = [addr.street, addr.extra].filter(Boolean).join(' ');
      pickupNotes = [w.window ? `Retira ${w.window}` : '', addr.rest].filter(Boolean).join(' | ');
      continue;
    }

    // ---------- Línea de entrega ----------
    const warnings: string[] = [];

    // Paréntesis: separo instrucciones de plata de producto/contacto
    const flags: string[] = [];
    const info: string[] = [];
    line = line.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      const t = inner.trim();
      if (
        RE_FLAG_NO_COBRAR.test(t) ||
        RE_FLAG_AL_RETIRAR.test(t) ||
        RE_FLAG_PAGADO.test(t) ||
        RE_FLAG_FLEX.test(t)
      ) {
        flags.push(t);
      } else {
        info.push(t);
      }
      return ' ';
    });

    const flagText = flags.join(' ');
    const isReminder = RE_FLAG_FLEX.test(flagText) || RE_FLAG_FLEX.test(line);
    if (isReminder) line = line.replace(/\bflex\b/gi, ' ');

    // Producto y contacto del destinatario
    let recipientName = '';
    let recipientPhone = '';
    let productDetail = '';
    if (info.length) {
      const parts = info.join(', ').split(/[,;]/).map((p) => p.trim()).filter(Boolean);
      const idx = parts.findIndex((p) => RE_PHONE.test(p));
      if (idx >= 0) {
        recipientPhone = (parts[idx].match(RE_PHONE)?.[0] ?? '').trim();
        recipientName = clean(parts[idx].replace(recipientPhone, ''));
        productDetail = parts.filter((_, i) => i !== idx).join(', ');
      } else {
        productDetail = parts.join(', ');
      }
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
        deliveryWindow,
        productDetail,
        paymentMode: second ? 'no_cobrar' : paymentMode,
        shippingFee: second ? 0 : shippingFee,
        merchandiseAmount: second ? 0 : merchandiseAmount,
        // Arranca igual a la mercadería; se edita a mano cuando el envío se suma aparte.
        amountToCollect: second ? 0 : paymentMode === 'cobrar_destinatario' ? merchandiseAmount : 0,
        notes: [
          addr.rest,
          stops.length > 1 ? `Envío de 2 paradas (${stops.join(' + ')}), precio conjunto.` : '',
          isReminder ? 'RECORDATORIO FLEX: se hace por la app de Mercado Libre.' : '',
        ]
          .filter(Boolean)
          .join(' | '),
        warnings: [...warnings],
        rawLine: original,
      });
    });
  }

  return rows;
}
