/**
 * Base local del celular (IndexedDB, vía `idb`).
 *
 * Guarda tres cosas:
 *  - `pending`: entregas cerradas sin señal, esperando subir. NUNCA se borran
 *    hasta que Supabase confirma; es la única copia del comprobante.
 *  - `hoja`: la hoja de ruta cacheada, para poder ver direcciones en un sótano.
 *  - `borrador`: la entrega a medio cerrar, por si Android mata la app mientras
 *    el repartidor saca la foto. Ver `guardarBorrador`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Shipment } from '@/lib/format';

export type DeliveryKind = 'entregado' | 'no_entregado';

export interface PendingDelivery {
  /** UUID armado en el celular: es lo que hace idempotente el reintento. */
  clientEventId: string;
  shipmentId: number;
  trackingCode: string;
  kind: DeliveryKind;
  reason: string | null;
  receiverName: string | null;
  receiverDni: string | null;
  /** "Recibió el encargado del edificio". Lo que la foto sola no cuenta. */
  comment: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** Momento real de la entrega, no el de la sincronización. */
  happenedAt: string;
  /** Una foto obligatoria y una segunda opcional. Nunca más de dos. */
  photos: Blob[];
  /**
   * Cómo se guardaba la foto antes del paso 18: una sola, o `null` en los FLEX.
   *
   * Queda leído —nunca escrito— porque en el celular de un repartidor puede
   * haber entregas encoladas de la versión anterior esperando señal. Si el
   * campo nuevo no está, la foto vieja sigue estando acá y hay que subirla
   * igual: es la única copia del comprobante.
   */
  photo?: Blob | null;
  tries: number;
  lastError: string | null;
  /**
   * Trabada: el servidor la rechazó por algo que no se arregla reintentando
   * (el envío ya no existe, se lo reasignaron a otro). Se deja de intentar y
   * queda a la vista para que el repartidor la descarte a mano.
   */
  blocked?: boolean;
}

/**
 * Una entrega a medio cargar.
 *
 * POR QUÉ EXISTE. Cuando la app abre la cámara, el celular la manda al fondo, y
 * Android es libre de matarla ahí mismo para darle memoria a la cámara. Pasa de
 * verdad: los repartidores avisaron que a veces tienen que reabrir la app dos y
 * tres veces. El sistema operativo hace eso y no hay forma de prohibírselo desde
 * una web.
 *
 * Lo que sí se puede es que no cueste nada. Con el borrador guardado, volver a
 * entrar y tocar de nuevo la entrega devuelve todo como estaba: la foto que ya
 * había sacado, quién recibió, el comentario. Sin esto, cada cierre de la app le
 * borraba el trabajo y tenía que arrancar de cero — que es lo que hace que dos
 * intentos se sientan diez.
 */
export interface BorradorEntrega {
  /** Uno solo a la vez: no se cierran dos entregas en paralelo. */
  id: 'actual';
  shipmentId: number;
  kind: DeliveryKind;
  receiverName: string;
  receiverDni: string;
  comment: string;
  reason: string;
  photos: Blob[];
  /** Para no resucitar el borrador de anteayer. */
  guardadoEn: number;
}

interface DriverDB extends DBSchema {
  pending: {
    key: string;
    value: PendingDelivery;
  };
  hoja: {
    key: number;
    value: Shipment;
  };
  borrador: {
    key: string;
    value: BorradorEntrega;
  };
}

const DB_NAME = 'dosruedas-repartidor';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<DriverDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<DriverDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('pending')) {
          db.createObjectStore('pending', { keyPath: 'clientEventId' });
        }
        if (!db.objectStoreNames.contains('hoja')) {
          db.createObjectStore('hoja', { keyPath: 'id' });
        }
        // Se agrega mirando si ya está, no según la versión anterior: así el
        // celular que venía de la versión 1 y el que instala hoy terminan
        // igual, y volver a correr esto nunca rompe nada.
        if (!db.objectStoreNames.contains('borrador')) {
          db.createObjectStore('borrador', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/* ------------------------------------------------------------ cola de envíos */

/**
 * Las fotos de una entrega encolada, venga del formato nuevo o del viejo.
 *
 * `photos` puede faltar de verdad aunque el tipo lo dé por seguro: los registros
 * que ya estaban en IndexedDB cuando el repartidor actualizó la app se
 * guardaron con el campo `photo`, en singular.
 */
export function pendingPhotos(item: PendingDelivery): Blob[] {
  const nuevas = item.photos as Blob[] | undefined;
  if (nuevas?.length) return nuevas;
  return item.photo ? [item.photo] : [];
}

export async function queueDelivery(item: PendingDelivery): Promise<void> {
  const db = await getDB();
  await db.put('pending', item);
}

export async function listPending(): Promise<PendingDelivery[]> {
  const db = await getDB();
  return db.getAll('pending');
}

export async function countPending(): Promise<number> {
  const db = await getDB();
  return db.count('pending');
}

/**
 * ¿Esta entrega sigue esperando en el celular?
 *
 * Es la única fuente de verdad sobre si se envió o no. Mirar el resultado de
 * `flushPending()` no alcanza: el reintento automático corre en paralelo y bien
 * puede haberla mandado él, con lo cual el flush del formulario no encuentra
 * nada que hacer y devuelve cero... que no es lo mismo que "no había señal".
 */
export async function isQueued(clientEventId: string): Promise<boolean> {
  const db = await getDB();
  return (await db.get('pending', clientEventId)) !== undefined;
}

/** Las que todavía vale la pena intentar (las trabadas quedan afuera). */
export async function listSendable(): Promise<PendingDelivery[]> {
  const all = await listPending();
  return all.filter((item) => !item.blocked);
}

/** Deja de reintentarla, pero NO la borra: la decisión de tirarla es humana. */
export async function markPendingBlocked(clientEventId: string, message: string): Promise<void> {
  const db = await getDB();
  const item = await db.get('pending', clientEventId);
  if (!item) return;
  await db.put('pending', { ...item, blocked: true, lastError: message, tries: item.tries + 1 });
}

/** Descarta todas las trabadas (las que el repartidor ya vio y aceptó perder). */
export async function dropBlocked(): Promise<number> {
  const all = await listPending();
  const blocked = all.filter((item) => item.blocked);
  const db = await getDB();
  await Promise.all(blocked.map((item) => db.delete('pending', item.clientEventId)));
  return blocked.length;
}

export async function dropPending(clientEventId: string): Promise<void> {
  const db = await getDB();
  await db.delete('pending', clientEventId);
}

/** Deja anotado el error para poder mostrarlo, y suma un intento. */
export async function markPendingError(clientEventId: string, message: string): Promise<void> {
  const db = await getDB();
  const item = await db.get('pending', clientEventId);
  if (!item) return;
  await db.put('pending', { ...item, tries: item.tries + 1, lastError: message });
}

/* ------------------------------------------------------- hoja de ruta cacheada */

export async function cacheRoute(shipments: Shipment[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('hoja', 'readwrite');
  await tx.store.clear();
  await Promise.all(shipments.map((s) => tx.store.put(s)));
  await tx.done;
}

export async function readCachedRoute(): Promise<Shipment[]> {
  const db = await getDB();
  return db.getAll('hoja');
}

/** Saca un envío del caché apenas se cierra, así no reaparece en la lista. */
export async function dropFromRoute(shipmentId: number): Promise<void> {
  const db = await getDB();
  await db.delete('hoja', shipmentId);
}


/* ------------------------------------------------- entrega a medio cerrar */

/** Más viejo que esto no se ofrece: es de otra jornada. */
const BORRADOR_VIVE_MS = 12 * 60 * 60 * 1000;

export async function guardarBorrador(
  b: Omit<BorradorEntrega, 'id' | 'guardadoEn'>,
): Promise<void> {
  try {
    const db = await getDB();
    await db.put('borrador', { ...b, id: 'actual', guardadoEn: Date.now() });
  } catch (e) {
    // Que falle guardar el borrador no puede frenar una entrega: es una red,
    // no el camino principal.
    console.warn('[borrador] no se pudo guardar', e);
  }
}

/** El borrador de ESE envío, si es de hoy. Si no, nada. */
export async function leerBorrador(
  shipmentId: number,
  kind: DeliveryKind,
): Promise<BorradorEntrega | null> {
  try {
    const db = await getDB();
    const b = await db.get('borrador', 'actual');
    if (!b) return null;
    if (b.shipmentId !== shipmentId || b.kind !== kind) return null;
    if (Date.now() - b.guardadoEn > BORRADOR_VIVE_MS) {
      await db.delete('borrador', 'actual');
      return null;
    }
    return b;
  } catch {
    return null;
  }
}

export async function borrarBorrador(): Promise<void> {
  try {
    const db = await getDB();
    await db.delete('borrador', 'actual');
  } catch {
    // Si no se pudo borrar, el que quede vence solo a las 12 horas.
  }
}
