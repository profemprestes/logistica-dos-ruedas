import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import webpush from 'web-push';

/**
 * Envía una notificación push a todos los celulares de un repartidor.
 *
 * Corre en el servidor porque necesita la clave privada VAPID, que firma los
 * mensajes y NUNCA puede viajar al navegador.
 *
 * Sólo lo puede llamar un admin: el que llama manda su token de sesión y acá se
 * verifica el rol. Si no, cualquiera con la URL podría spamear a los choferes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Suscripcion {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
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

function configurarVapid(): boolean {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  const sujeto = process.env.VAPID_SUBJECT || 'mailto:info@enviosdosruedas.com';
  if (!publica || !privada) return false;
  webpush.setVapidDetails(sujeto, publica, privada);
  return true;
}

export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Falta configurar el servidor.' }, { status: 500 });
  }

  if (!configurarVapid()) {
    return NextResponse.json(
      { error: 'Faltan las claves VAPID en las variables de entorno.' },
      { status: 500 },
    );
  }

  // --- quién llama ---------------------------------------------------------
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /i, '');
  if (!token) return NextResponse.json({ error: 'Sin sesión.' }, { status: 401 });

  const { data: userData, error: authError } = await admin.auth.getUser(token);
  if (authError || !userData.user) {
    return NextResponse.json({ error: 'Sesión inválida.' }, { status: 401 });
  }

  const { data: perfil } = await admin
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if ((perfil as { role?: string } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Sólo un admin puede notificar.' }, { status: 403 });
  }

  // --- qué se manda --------------------------------------------------------
  const body = (await request.json().catch(() => ({}))) as {
    driverId?: string;
    title?: string;
    body?: string;
    url?: string;
    tag?: string;
  };

  if (!body.driverId || !body.title) {
    return NextResponse.json({ error: 'Faltan driverId o title.' }, { status: 400 });
  }

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('driver_id', body.driverId);

  const lista = (subs ?? []) as unknown as Suscripcion[];
  if (lista.length === 0) {
    // No es un error: el repartidor todavía no activó las notificaciones.
    return NextResponse.json({ enviadas: 0, sinSuscripcion: true });
  }

  const payload = JSON.stringify({
    title: body.title,
    body: body.body ?? '',
    url: body.url ?? '/driver/dashboard',
    tag: body.tag,
  });

  let enviadas = 0;
  const vencidas: number[] = [];

  await Promise.all(
    lista.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        enviadas += 1;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 = el celular desinstaló la app o revocó el permiso.
        if (status === 404 || status === 410) vencidas.push(s.id);
        else console.error('[notify] falló el envío', { endpoint: s.endpoint.slice(-12), status, err });
      }
    }),
  );

  if (vencidas.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', vencidas);
    console.info(`[notify] ${vencidas.length} suscripción(es) vencida(s) dadas de baja.`);
  }

  return NextResponse.json({ enviadas, vencidas: vencidas.length });
}
