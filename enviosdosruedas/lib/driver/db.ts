/**
 * Base local del celular (IndexedDB, vía `idb`).
 *
 * Guarda dos cosas:
 *  - `pending`: entregas cerradas sin señal, esperando subir. NUNCA se borran
 *    hasta que Supabase confirma; es la única copia del comprobante.
 *  - `hoja`: la hoja de ruta cacheada, para poder ver direcciones en un sótano.
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
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  /** Momento real de la entrega, no el de la sincronización. */
  happenedAt: string;
  /** Los FLEX no llevan comprobante: va en null. */
  photo: Blob | null;
  tries: number;
  lastError: string | null;
  /**
   * Trabada: el servidor la rechazó por algo que no se arregla reintentando
   * (el envío ya no existe, se lo reasignaron a otro). Se deja de intentar y
   * queda a la vista para que el repartidor la descarte a mano.
   */
  blocked?: boolean;
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
}

const DB_NAME = 'dosruedas-repartidor';
const DB_VERSION = 1;

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
      },
    });
  }
  return dbPromise;
}

/* ------------------------------------------------------------ cola de envíos */

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
