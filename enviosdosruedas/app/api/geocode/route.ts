import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { geocodificar } from '@/lib/geocode';

/**
 * Le pone coordenadas a los envíos que no las tienen.
 *
 * Corre en el servidor por dos motivos. Uno, la política de Nominatim: pide un
 * User-Agent que identifique a quien llama y como máximo una consulta por
 * segundo, y desde el navegador sería una consulta por repartidor y por envío.
 * Dos, escribir en `shipments` desde acá va con la clave de servicio, sin pelear
 * con el RLS.
 *
 * Se llama solo al guardar un envío desde el panel, y también se puede llamar
 * sin `ids` para ponerse al día con los que quedaron sin punto.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Cuántos por llamada.
 *
 * A una consulta por segundo, seis son unos siete segundos: entra cómodo en el
 * tiempo que da Vercel. Si quedan más, la respuesta lo dice y se vuelve a
 * llamar. Mejor varias llamadas cortas que una que se corta por la mitad.
 */
const POR_LLAMADA = 6;

/** Nominatim pide 1 por segundo. 1,1 s deja margen para el redondeo. */
const ESPERA_MS = 1100;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cached: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

async function requireAdmin(request: Request, admin: SupabaseClient) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  return profile?.role === 'admin' ? data.user : null;
}

interface Fila {
  id: number;
  address_street: string;
  city: string | null;
}

export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Falta configurar el servidor.' }, { status: 500 });
  }

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });
  }

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: number[] };

  // Sólo los que no tienen punto: geocodificar dos veces lo mismo es gastar
  // el cupo de Nominatim al pedo.
  let q = admin
    .from('shipments')
    .select('id, address_street, city')
    .is('lat', null)
    .limit(POR_LLAMADA + 1);

  if (ids?.length) q = q.in('id', ids);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const filas = (data ?? []) as Fila[];
  const tanda = filas.slice(0, POR_LLAMADA);

  let guardados = 0;
  let sinPunto = 0;

  for (let i = 0; i < tanda.length; i++) {
    const fila = tanda[i];
    if (i > 0) await dormir(ESPERA_MS);

    const punto = await geocodificar(fila.address_street, fila.city ?? 'Mar del Plata');

    if (!punto) {
      sinPunto++;
      continue;
    }

    const { error: upError } = await admin
      .from('shipments')
      .update({ lat: punto.lat, lng: punto.lng })
      .eq('id', fila.id);

    if (upError) sinPunto++;
    else guardados++;
  }

  return NextResponse.json({
    procesados: tanda.length,
    guardados,
    sinPunto,
    /** `true` si quedaron más esperando: conviene volver a llamar. */
    quedanMas: filas.length > POR_LLAMADA,
  });
}
