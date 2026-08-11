/**
 * Sincronización de la cola offline con Supabase.
 *
 * Orden por entrega: primero sube la foto al bucket, después llama al RPC.
 * Si el RPC falla, la foto ya subida se pisa sola en el reintento (mismo path),
 * así que no quedan huérfanas ni se duplica nada.
 *
 * REGLA IMPORTANTE: un error de red y un error del servidor NO son lo mismo.
 *  - Sin señal      -> se reintenta solo, y al repartidor se le dice "sin conexión".
 *  - Error del server (RLS, RPC roto, permisos del bucket) -> reintentar no sirve;
 *    hay que MOSTRAR el mensaje real, porque si no la app parece colgada.
 * Mezclarlos fue lo que hizo que una entrega con wifi dijera "esperando señal".
 */
import { supabase } from '@/lib/supabaseClient';
import {
  dropPending,
  listSendable,
  markPendingBlocked,
  markPendingError,
  type PendingDelivery,
} from '@/lib/driver/db';
import { errorText, isPermanentError } from '@/lib/driver/errors';

/**
 * Mismo bucket que mira el panel en ProofOfDeliveryModal. Si el repartidor sube
 * a otro lado, el admin abre la prueba de entrega y no encuentra la foto.
 */
const BUCKET = 'delivery-photos';

/** Rechazos seguidos antes de dar una entrega por trabada. */
const MAX_TRIES = 4;

export type FailureKind = 'red' | 'servidor' | 'permanente';

export interface SyncOutcome {
  /** Entregas confirmadas por Supabase en esta pasada. */
  sent: number;
  /** Fallaron por falta de señal: se reintentan solas. */
  networkFailures: number;
  /** Las rechazó el servidor por algo que puede mejorar: se siguen intentando. */
  serverFailures: number;
  /** Quedaron trabadas para siempre (envío borrado, reasignado a otro). */
  blocked: number;
  /** Texto del último rechazo del servidor, para mostrárselo a alguien. */
  lastServerError: string | null;
  /** Ya había otra sincronización corriendo: esta pasada no hizo nada. */
  skipped: boolean;
}

const EMPTY: SyncOutcome = {
  sent: 0,
  networkFailures: 0,
  serverFailures: 0,
  blocked: 0,
  lastServerError: null,
  skipped: false,
};

/** Evita que dos disparos (online + timer + botón) suban lo mismo a la vez. */
let running = false;

export async function flushPending(): Promise<SyncOutcome> {
  if (running) {
    console.info('[sync] ya había una sincronización en curso, no arranco otra.');
    return { ...EMPTY, skipped: true };
  }

  running = true;
  const outcome: SyncOutcome = { ...EMPTY };

  try {
    // Las trabadas no entran: reintentarlas es tiempo y batería tirados.
    const pending = await listSendable();
    if (pending.length === 0) return outcome;

    console.info(`[sync] arrancando: ${pending.length} entrega(s) en la cola.`);

    for (const item of pending) {
      try {
        await pushOne(item);
        await dropPending(item.clientEventId);
        outcome.sent += 1;
        console.info(`[sync] OK envío ${item.shipmentId} (${item.trackingCode}).`);
      } catch (err) {
        const { kind, message } = classify(err);

        if (kind === 'red') {
          outcome.networkFailures += 1;
          await markPendingError(item.clientEventId, message);
          console.warn(`[sync] sin conexión con el envío ${item.shipmentId}: ${message}`);
          // Si se cortó la señal no tiene sentido seguir con el resto de la cola.
          break;
        }

        if (kind === 'permanente') {
          outcome.blocked += 1;
          outcome.lastServerError = message;
          await markPendingBlocked(item.clientEventId, message);
          console.error(
            `[sync] envío ${item.shipmentId} (${item.trackingCode}) trabado para siempre: ${message}`,
            err,
          );
          continue;
        }

        // Después de varios rechazos seguidos deja de ser "temporal": se traba
        // para que el repartidor la vea y decida, en vez de reintentar por siempre.
        if (item.tries + 1 >= MAX_TRIES) {
          outcome.blocked += 1;
          outcome.lastServerError = message;
          await markPendingBlocked(item.clientEventId, message);
          console.error(
            `[sync] envío ${item.shipmentId} falló ${item.tries + 1} veces, lo trabo: ${message}`,
            err,
          );
          continue;
        }

        outcome.serverFailures += 1;
        outcome.lastServerError = message;
        await markPendingError(item.clientEventId, message);
        console.error(`[sync] el servidor rechazó el envío ${item.shipmentId}: ${message}`, err);
        // Seguimos con los demás: puede ser un problema de ese envío puntual.
      }
    }
  } finally {
    running = false;
  }

  console.info('[sync] fin:', outcome);
  return outcome;
}

async function pushOne(item: PendingDelivery): Promise<void> {
  // Los FLEX no llevan comprobante: se cierran en la app de Mercado Libre y acá
  // sólo queda el registro con la ubicación. Sin foto no hay nada que subir.
  let path: string | null = null;

  if (item.photo) {
    path = `${item.shipmentId}/${item.clientEventId}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, item.photo, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) {
      console.error('[sync] falló la subida de la foto', { path, uploadError });
      throw uploadError;
    }
  }

  const { error: rpcError } = await supabase.rpc('resolve_delivery', {
    p_client_event_id: item.clientEventId,
    p_shipment_id: item.shipmentId,
    p_kind: item.kind,
    p_happened_at: item.happenedAt,
    p_reason: item.reason,
    p_receiver_name: item.receiverName,
    p_receiver_dni: item.receiverDni,
    p_lat: item.lat,
    p_lng: item.lng,
    p_accuracy_m: item.accuracy,
    p_photo_path: path,
    // Las entregas que quedaron en la cola de antes del paso 15 no traen el
    // campo: `?? null` evita que salgan como "undefined" al servidor.
    p_comment: item.comment ?? null,
  });

  if (rpcError) {
    // code/details/hint son los que dicen si fue RLS, un tipo mal o la función rota.
    console.error('[sync] falló resolve_delivery', {
      shipmentId: item.shipmentId,
      code: rpcError.code,
      message: rpcError.message,
      details: rpcError.details,
      hint: rpcError.hint,
    });
    throw rpcError;
  }
}

/**
 * ¿Se cayó la red o nos contestó el servidor?
 *
 * `fetch` tira TypeError cuando no llega a destino; Supabase lo envuelve pero
 * deja el texto ("Failed to fetch", "Load failed" en Safari). Cualquier otra
 * cosa (un código de Postgres, un 401, un 403 de RLS) YA es una respuesta:
 * hubo internet, el problema es otro.
 */
function classify(err: unknown): { kind: FailureKind; message: string } {
  if (err instanceof TypeError) {
    return { kind: 'red', message: 'No se pudo llegar al servidor.' };
  }

  const e = err as { message?: string; status?: number; statusCode?: string; code?: string };
  const text = e?.message ?? String(err);

  // Lo definitivo se detecta antes que nada: un envío borrado no vuelve por
  // más que aparezca la señal, y reintentarlo cada minuto no lleva a ningún lado.
  if (isPermanentError(text, e?.code)) {
    return { kind: 'permanente', message: errorText(text) };
  }

  if (/failed to fetch|networkerror|load failed|network request failed|timeout/i.test(text)) {
    return { kind: 'red', message: 'No se pudo llegar al servidor.' };
  }

  // 0 = ni salió; 5xx/408 = el server no está en condiciones. Ambos se reintentan.
  const status = Number(e?.status ?? e?.statusCode ?? NaN);
  if (status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return { kind: 'red', message: `El servidor no responde (${status}).` };
  }

  if (!navigator.onLine) {
    return { kind: 'red', message: 'El celular quedó sin conexión.' };
  }

  return { kind: 'servidor', message: errorText(text) || 'El servidor rechazó la entrega.' };
}

/**
 * Engancha la sincronización a la vuelta de la señal.
 * Devuelve la función para desengancharla.
 */
export function watchConnection(onFlushed: (outcome: SyncOutcome) => void): () => void {
  const run = () => {
    flushPending().then((outcome) => {
      if (outcome.skipped) return;
      if (outcome.sent > 0 || outcome.serverFailures > 0 || outcome.blocked > 0) onFlushed(outcome);
    });
  };

  window.addEventListener('online', run);
  // Volver a la app después de un rato también es buen momento para reintentar.
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  document.addEventListener('visibilitychange', onVisible);

  // Red de seguridad: el evento 'online' miente cuando hay wifi sin internet.
  const timer = window.setInterval(run, 60_000);

  return () => {
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}
