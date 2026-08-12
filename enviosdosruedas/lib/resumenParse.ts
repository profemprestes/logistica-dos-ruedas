/**
 * De un pegote de WhatsApp a la lista de pedidos del día.
 *
 * Portado del generador que se usaba aparte. Las reglas raras que tiene no son
 * caprichos: cada una salió de un mensaje real que se leía mal. Antes de tocar
 * alguna, probala contra un día entero de mensajes.
 *
 * Es un parser distinto al de `lib/parseWhatsapp.ts`, que arma envíos para
 * cargar (destinatario, dirección, teléfono). Este arma renglones de plata
 * (comercio, cuánto cobra, cuánto es el envío). Mismo texto de entrada, dos
 * cosas distintas del otro lado.
 */
import { REGLAS, esShippy, type Pedido } from '@/lib/resumen';

export interface Producto {
  nombre: string;
  cantidad: number;
}

/** Palabras que delatan que un renglón es un pedido y no el nombre de un comercio. */
const PALABRAS_PEDIDO = ['ENVIO', 'ENVÍO', 'COBRAR', 'RETIRA', 'ENTREGA'];

const parecePedido = (texto: string) =>
  PALABRAS_PEDIDO.some((p) => texto.includes(p)) || texto.startsWith('-');

/**
 * Saca la franja horaria del principio de la dirección.
 *
 * "18 A 20HS DUTTO 2733", "ANTES 19HS CALABRIA 5543": el horario es
 * instrucción para el repartidor, no parte de la dirección, y en el resumen
 * sólo estorba. Da vueltas hasta que no saca nada más porque los mensajes
 * apilan dos y tres condiciones seguidas.
 */
function sacarHorarios(texto: string): string {
  let anterior;
  let desc = texto;
  do {
    anterior = desc;
    desc = desc.replace(
      /^\d{1,2}(?:\s*[:.]?\s*\d{2})?\s*(?:HS|HRS|H|BS)?\s*(?:A|AL|Y|-)\s*\d{1,2}(?:\s*[:.]?\s*\d{2})?\s*(?:HS|HRS|H|BS)\b\.?\s*/i,
      '',
    );
    desc = desc.replace(
      /^(?:ANTES DE|ANTES|DESDE|HASTA|LUEGO DE|LUEGO|A PARTIR DE)\s*\d{1,2}(?:\s*[:.]?\s*\d{2})?\s*(?:HS|HRS|H|BS)\b\.?\s*/i,
      '',
    );
    desc = desc.replace(/^O\s+/i, '');
    desc = desc.replace(/^[-.,*\s]+/, '');
  } while (desc !== anterior);
  return desc;
}

/** Los productos entre paréntesis de un pedido de Shippy: "(remera x2, buzo x1)". */
function sacarProductos(linea: string): Producto[] {
  const entre = linea.match(/\((.*?)\)/);
  if (!entre) return [];

  const productos: Producto[] = [];
  const re = /([a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+?)\s*[xX]\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(entre[1])) !== null) {
    productos.push({ nombre: m[1].trim().toUpperCase(), cantidad: parseInt(m[2], 10) });
  }
  return productos;
}

const numero = (texto: string) => parseInt(texto.replace(/\./g, ''), 10) || 0;

export interface PedidoPegado extends Pedido {
  productos: Producto[];
}

export function parsearResumen(texto: string): PedidoPegado[] {
  const pedidos: PedidoPegado[] = [];
  let comercio = 'GENERAL';

  for (const original of String(texto ?? '').split('\n')) {
    let linea = original.trim();
    if (!linea) continue;

    // 1. Renglón exportado de WhatsApp: "[12/8, 09:14] Matías: ...". Lo que
    //    viene después de los dos puntos puede ser un pedido o el nombre del
    //    comercio que arranca una tanda.
    const wa = linea.match(/^\[.*?\](.*?):\s*(.*)$/);
    if (wa) {
      const contenido = wa[2].trim();
      if (parecePedido(contenido.toUpperCase())) {
        linea = contenido;
      } else {
        comercio = contenido.replace(/\*/g, '').trim().toUpperCase();
        continue;
      }
    } else {
      // 2. El comercio en negrita: *TOYPIOLA*
      const negrita = linea.match(/^\*([^*]+)\*$/);
      if (negrita) {
        comercio = negrita[1].trim().toUpperCase();
        continue;
      }

      // 3. Sin negrita ni nada: un renglón corto que no parece pedido es el
      //    comercio. El límite de 35 caracteres evita comerse una dirección.
      const enMayusculas = linea.toUpperCase();
      if (
        !parecePedido(enMayusculas) &&
        !enMayusculas.startsWith('[') &&
        linea.length > 0 &&
        linea.length < 35
      ) {
        comercio = linea.replace(/\*/g, '').trim().toUpperCase();
        continue;
      }
    }

    const enMayusculas = linea.toUpperCase();
    const esPedido =
      enMayusculas.includes('COBRAR') ||
      enMayusculas.includes('ENVIO') ||
      enMayusculas.includes('ENVÍO') ||
      linea.startsWith('-');
    if (!esPedido) continue;

    const shippy = esShippy(comercio);

    // El precio del envío. Shippy casi nunca lo escribe: va el de lista.
    const envioEscrito = linea.match(/ENV(?:I|Í)O\s*\$?([0-9.]+)/i);
    const envio = envioEscrito
      ? numero(envioEscrito[1])
      : shippy
        ? REGLAS.envioShippyPorDefecto
        : 0;

    // "Cobrar envío" quiere decir que le cobra al destinatario el envío y nada
    // más; no hay un monto aparte que buscar.
    let cobrar = 0;
    if (
      enMayusculas.includes('COBRAR ENVIO') ||
      enMayusculas.includes('COBRAR ENVÍO') ||
      enMayusculas.includes('COBRAR AL RETIRAR')
    ) {
      cobrar = envio;
    } else {
      const cobrarEscrito = linea.match(/COBRAR\s*\$?([0-9.]+)/i);
      if (cobrarEscrito) cobrar = numero(cobrarEscrito[1]);
    }

    // La descripción es todo lo que hay antes de la plata.
    let limpia = linea.replace(/^\[[^\]]+\][^:]+:\s*/, '').replace(/^-\s*/, '');
    const corteConPunto = limpia.toUpperCase().search(/\.\s*(COBRAR|ENVIO|ENVÍO)/);
    if (corteConPunto !== -1) {
      limpia = limpia.slice(0, corteConPunto);
    } else {
      const corte = limpia.toUpperCase().search(/(COBRAR|ENVIO|ENVÍO)/);
      if (corte !== -1) limpia = limpia.slice(0, corte);
    }

    const descripcion = sacarHorarios(limpia.trim()) || 'Dirección no identificada';

    pedidos.push({
      tempId: crypto.randomUUID(),
      comercio: shippy ? 'SHIPPY' : comercio,
      comercioOriginal: comercio,
      descripcion,
      cobrar,
      envio,
      esShippy: shippy,
      shipmentId: null,
      productos: shippy ? sacarProductos(original) : [],
    });
  }

  return pedidos;
}
