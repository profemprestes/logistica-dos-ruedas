import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Seguimiento público de un envío por su código EDR.
 *
 * Corre en el servidor a propósito: consulta con la clave de servicio y devuelve
 * SÓLO los campos que se pueden mostrar en la vía pública. Así no hace falta
 * abrirle la tabla `shipments` al rol anónimo, que expondría todo el padrón de
 * clientes a cualquiera.
 *
 * Lo que NO se devuelve nunca: teléfono del destinatario, DNI de quien recibió,
 * datos del comercio, montos ni nada de plata.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** EDR + 8 dígitos + 3 letras (ej: EDR00001015MDQ). */
const CODE_RE = /^EDR\d{6,10}[A-Z]{0,4}$/i;

/** Sólo los campos que pedimos; supabase-js sin tipos generados devuelve `any`. */
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

export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'El servidor no está configurado.' }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = (body.code ?? '').trim().toUpperCase();

  if (!CODE_RE.test(code)) {
    return NextResponse.json(
      { error: 'El código tiene que empezar con EDR. Fijate en la etiqueta del paquete.' },
      { status: 400 },
    );
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
    return NextResponse.json({ error: 'No pudimos consultar el envío. Probá de nuevo.' }, { status: 500 });
  }

  if (!shipment) {
    return NextResponse.json({ error: 'No encontramos ningún envío con ese código.' }, { status: 404 });
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

  return NextResponse.json({
    code: shipment.tracking_code,
    status: shipment.status,
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
  });
}
