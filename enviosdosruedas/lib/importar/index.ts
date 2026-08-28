import type { ParsedRow } from '@/lib/parseWhatsapp';
import { renglonesDePdf } from './pdf';
import { armarTabla, type FilaDeTabla } from './tabla';
import type { Arreglo, Campo, Plantilla } from './plantillas';

/**
 * Un archivo de un comercio, convertido en los mismos envíos que produce pegar
 * el WhatsApp.
 *
 * DEVUELVE `ParsedRow[]` A PROPÓSITO. De ahí en adelante el archivo y el
 * mensaje pegado son la misma cosa: la tabla de revisión, el enlace a la ficha,
 * el punto de retiro, la fecha del lote, el pedido del depósito y el guardado
 * ya existen y andan. Si esto devolviera una forma propia habría dos caminos
 * para lo mismo, y el segundo siempre queda atrás del primero.
 */

export { PLANTILLAS, plantillaPorId, type Plantilla } from './plantillas';

let contador = 0;
/** Prefijo distinto del de la tanda pegada: nunca pueden chocar. */
const nuevoId = () => `arch-${Date.now()}-${contador++}`;

/* ------------------------------------------------------- arreglos de formato */

const RE_COLA_GEOGRAFICA =
  /,?\s*(GRAL\s+PUEYRREDON|GENERAL\s+PUEYRREDON|BUENOS\s+AIRES\s*\d*|ARGENTINA)\b.*$/i;

const TIPOS_DE_CALLE = /^(.+?)\s*,\s*(AV|AVDA|AVENIDA|DIAG|DIAGONAL|BV|BLVD|CALLE|PJE|PASAJE)\.?\s+(.+)$/i;

function aplicarArreglos(direccion: string, arreglos: Arreglo[]): string {
  let s = direccion;

  if (arreglos.includes('cola-geografica')) {
    s = s.replace(RE_COLA_GEOGRAFICA, '');
  }

  if (arreglos.includes('tipo-de-calle-al-final')) {
    const vuelta = s.replace(/[,\s]+$/, '').match(TIPOS_DE_CALLE);
    if (vuelta) s = `${vuelta[2].toUpperCase()}. ${vuelta[1]} ${vuelta[3]}`;
  }

  return s
    .replace(/[,\s]+$/, '')
    .replace(/^[,\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Piso y puerta como los lee el repartidor.
 *
 * Van juntos en un solo campo porque así está armado el envío, y porque en la
 * puerta se leen juntos: "Piso 3 Dto G". El "PB" se deja tal cual —nadie dice
 * "piso PB"— y la puerta va en mayúscula, que es como está en los timbres.
 */
function pisoYPuerta(piso: string, puerta: string): string {
  const p = piso.trim();
  const d = puerta.trim();
  return [
    p ? (/^p\.?\s*b\.?$/i.test(p) ? 'PB' : `Piso ${p}`) : '',
    d ? `Dto ${d.toUpperCase()}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** "28/08/2026" -> "2026-08-28". Cualquier otra cosa, vacío. */
function fechaISO(texto: string): string {
  const m = texto.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ público */

/**
 * Lo que el archivo dice que lleva cada envío, sin cruzar todavía contra el
 * depósito.
 *
 * Va aparte del envío porque el pedido de stock no es un campo del envío: es
 * una fila en otra tabla, y para armarla hace falta el `product_id` que sólo se
 * sabe cuando llegaron los productos del comercio. Acá queda el nombre tal cual
 * lo escribió el comercio —"CONTROL FLOW"— y del otro lado se busca.
 */
export interface PedidoDelArchivo {
  tempId: string;
  nombre: string;
  cantidad: number;
}

export interface EnviosDelArchivo {
  filas: ParsedRow[];
  /** La fecha que venía escrita en el archivo, si la había. */
  fecha: string;
  /** Para contárselo al que sube: "13 envíos leídos". */
  leidas: number;
  pedidos: PedidoDelArchivo[];
}

/**
 * Lee el archivo con la plantilla del comercio y arma los envíos.
 *
 * `scheduledDate` es la fecha con la que quedan si el archivo no trae ninguna:
 * la del lote que ya está elegida en la pantalla.
 */
export async function enviosDeArchivo(
  datos: ArrayBuffer,
  plantilla: Plantilla,
  scheduledDate: string,
): Promise<EnviosDelArchivo> {
  const renglones = await renglonesDePdf(datos);
  const tabla = armarTabla(renglones, {
    titulos: plantilla.columnas.map((c) => c.titulo),
    ancla: plantilla.ancla,
  });

  const fecha = plantilla.fechaEn ? fechaISO(tabla.encabezado[plantilla.fechaEn] ?? '') : '';
  const dia = fecha || scheduledDate;

  const dondeEsta = (fila: FilaDeTabla, campo: Campo): string => {
    const col = plantilla.columnas.find((c) => c.campo === campo);
    return col ? (fila[col.titulo] ?? '').trim() : '';
  };

  const pedidos: PedidoDelArchivo[] = [];

  const filas = tabla.filas.map<ParsedRow>((fila) => {
    const direccion = aplicarArreglos(dondeEsta(fila, 'direccion'), plantilla.arreglos);
    const telefono = dondeEsta(fila, 'telefono').replace(/[^\d+]/g, '');
    const destinatario = dondeEsta(fila, 'destinatario');
    const cantidad = dondeEsta(fila, 'cantidad');
    const producto = dondeEsta(fila, 'producto');

    const warnings: string[] = [];
    if (!destinatario) warnings.push('El archivo no trae a quién se le entrega.');
    if (!direccion) warnings.push('No se detectó la dirección de entrega.');
    else if (!/\d/.test(direccion)) warnings.push('La dirección no tiene altura: revisala en el mapa.');
    if (telefono.replace(/\D/g, '').length < 8) {
      warnings.push('Sin teléfono: este envío no le va a avisar nada al destinatario.');
    }

    const tempId = nuevoId();
    if (producto) {
      pedidos.push({ tempId, nombre: producto, cantidad: Number(cantidad) || 1 });
    }

    return {
      tempId,
      isReminder: false,
      clientName: plantilla.comercio,
      pickupAddress: plantilla.retiroFijo ?? '',
      pickupNotes: '',
      recipientName: destinatario,
      recipientPhone: telefono,
      addressStreet: direccion,
      addressExtra: pisoYPuerta(dondeEsta(fila, 'piso'), dondeEsta(fila, 'puerta')),
      city: plantilla.ciudad,
      scheduledDate: dia,
      deliveryWindow: dondeEsta(fila, 'horario'),
      productDetail: producto ? (cantidad ? `${cantidad}× ${producto}` : producto) : '',
      /*
       * Sin plata. Estas hojas de ruta no traen montos: el comercio tiene
       * tarifa acordada y se le factura aparte, así que el repartidor no cobra
       * nada en la puerta. Es lo mismo que hace la tanda pegada cuando el
       * mensaje no dice ningún importe, y sin el aviso de "no se detectó
       * ningún monto", que acá no es un descuido sino cómo es el trabajo.
       */
      paymentMode: 'no_cobrar',
      shippingFee: 0,
      merchandiseAmount: 0,
      amountToCollect: 0,
      notes: '',
      warnings,
      rawLine: Object.values(fila).join(' | '),
      lat: null,
      lng: null,
    };
  });

  return { filas, fecha, leidas: tabla.filas.length, pedidos };
}
