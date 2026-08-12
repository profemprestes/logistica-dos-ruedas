import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TrackResult } from '@/components/ProofOfDelivery';

/**
 * Búsqueda del seguimiento público, del lado del servidor.
 *
 * Vive acá y no dentro de la ruta de API porque la usan dos: `/api/track`
 * (que quedó para lo que ya la llamaba) y la página `/seguimiento/CODIGO`,
 * que la resuelve del lado del servidor para que el link se pueda compartir.
 *
 * Consulta con la clave de servicio y devuelve SÓLO los campos que se pueden
 * mostrar en la vía pública. Lo que NO sale nunca: teléfono del destinatario,
 * DNI de quien recibió, datos del comercio, montos ni nada de plata.
 */

/** EDR + dígitos + sufijo de ciudad (ej: EDR00001015MDQ). */
export const CODE_RE = /^EDR\d{6,10}[A-Z]{0,4}$/i;

interface ShipmentRow {
  id: number;
  tracking_code: string;
  status: string;
  recipient_name: string;
  address_street: string;
  address_extra: string | null;
  city: string;
  delivery_window: string | null;
  scheduled_date: string;
  created_at: string;
  delivered_at: string | null;
  is_flex: boolean | null;
  lat: number | null;
  lng: number | null;
}

interface LogRow {
  event: string;
  happened_at: string;
  failure_reason: string | null;
  receiver_name: string | null;
  photo_path: string | null;
  lat: number | null;
  lng: number | null;
}

let cached: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export type TrackLookup =
  | { ok: true; data: TrackResult }
  | { ok: false; status: number; error: string };

export async function buscarEnvio(codigo: string): Promise<TrackLookup> {
  const admin = getAdminClient();
  if (!admin) {
    return { ok: false, status: 500, error: 'El servidor no está configurado.' };
  }

  const code = (codigo ?? '').trim().toUpperCase();

  if (!CODE_RE.test(code)) {
    return {
      ok: false,
      status: 400,
      error: 'El código tiene que empezar con EDR. Fijate en la etiqueta del paquete.',
    };
  }

  const { data: fila, error } = await admin
    .from('shipments')
    .select(
      'id, tracking_code, status, recipient_name, address_street, address_extra, city, ' +
        'delivery_window, scheduled_date, created_at, delivered_at, is_flex, lat, lng',
    )
    .eq('tracking_code', code)
    .maybeSingle();

  const shipment = fila as ShipmentRow | null;

  if (error) {
    console.error('[seguimiento] no se pudo consultar', error);
    return { ok: false, status: 500, error: 'No pudimos consultar el envío. Probá de nuevo.' };
  }

  if (!shipment) {
    return { ok: false, status: 404, error: 'No encontramos ningún envío con ese código.' };
  }

  // Último movimiento del repartidor, que es el que cierra la historia.
  const { data: logs } = await admin
    .from('delivery_logs')
    .select('event, happened_at, failure_reason, receiver_name, photo_path, lat, lng')
    .eq('shipment_id', shipment.id)
    .order('happened_at', { ascending: false });

  const movimientos = (logs ?? []) as unknown as LogRow[];
  const cierre = movimientos.find((l) => l.event === 'entregado' || l.event === 'no_entregado');

  // La foto vive en un bucket privado: se firma un link temporal de 1 hora.
  let photoUrl: string | null = null;
  if (cierre?.photo_path) {
    const { data: signed } = await admin.storage
      .from('delivery-photos')
      .createSignedUrl(cierre.photo_path, 3600);
    photoUrl = signed?.signedUrl ?? null;
  }

  return {
    ok: true,
    data: {
      code: shipment.tracking_code,
      status: shipment.status as TrackResult['status'],
      isFlex: Boolean(shipment.is_flex),
      recipient: shipment.recipient_name,
      address: [shipment.address_street, shipment.address_extra].filter(Boolean).join(' — '),
      city: shipment.city,
      window: shipment.delivery_window,
      scheduledDate: shipment.scheduled_date,
      createdAt: shipment.created_at,
      deliveredAt: shipment.delivered_at,
      // Punto de entrega: primero el que marcó el repartidor, si no el del envío.
      lat: cierre?.lat ?? shipment.lat ?? null,
      lng: cierre?.lng ?? shipment.lng ?? null,
      proof: cierre
        ? {
            event: cierre.event as 'entregado' | 'no_entregado',
            happenedAt: cierre.happened_at,
            receiverName: cierre.receiver_name,
            failureReason: cierre.failure_reason,
            photoUrl,
          }
        : null,
      /** Hitos para la línea de tiempo, del más viejo al más nuevo. */
      timeline: [...movimientos].reverse().map((l) => ({
        event: l.event,
        happenedAt: l.happened_at,
      })),
    },
  };
}
