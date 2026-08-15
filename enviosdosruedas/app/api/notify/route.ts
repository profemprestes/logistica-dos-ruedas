import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import webpush from 'web-push';
import { hayFirebase, mandarAvisoFcm } from '@/lib/server/firebase';

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

  /*
   * Ya no alcanza con que falte VAPID para cortar acá.
   *
   * Son dos caminos independientes: si están las claves del navegador pero no
   * las de Firebase —o al revés— hay que mandar por el que sí está configurado
   * en vez de dejar a todos sin aviso. Se corta sólo si no hay ninguno.
   */
  const hayVapid = configurarVapid();

  if (!hayVapid && !hayFirebase()) {
    return NextResponse.json(
      { error: 'No hay forma de notificar: faltan las claves VAPID y las de Firebase.' },
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

  /*
   * DOS DESTINOS, y hay que mirar los dos.
   *
   * `push_subscriptions` son los navegadores (paso 10) y `push_tokens` la app
   * de Android (paso 35). Un repartidor puede estar en las dos: el celular con
   * la app y la compu de la oficina. Se le manda a todo lo que tenga, que es lo
   * que ya se venía haciendo cuando alguien tenía dos navegadores.
   */
  const [{ data: subs }, { data: tokens }] = await Promise.all([
    admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('driver_id', body.driverId),
    admin.from('push_tokens').select('id, token').eq('driver_id', body.driverId),
  ]);

  const lista = (subs ?? []) as unknown as Suscripcion[];
  const nativos = (tokens ?? []) as unknown as { id: number; token: string }[];

  if (lista.length === 0 && nativos.length === 0) {
    // No es un error: el repartidor todavía no activó las notificaciones.
    return NextResponse.json({ enviadas: 0, sinSuscripcion: true });
  }

  const destino = body.url ?? '/driver/dashboard';

  const payload = JSON.stringify({
    title: body.title,
    body: body.body ?? '',
    url: destino,
    tag: body.tag,
  });

  let enviadas = 0;
  const vencidas: number[] = [];
  const tokensVencidos: number[] = [];

  await Promise.all(
    (hayVapid ? lista : []).map(async (s) => {
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

  // --- y lo mismo por Firebase, para la app de Android ---------------------
  if (nativos.length > 0 && hayFirebase()) {
    await Promise.all(
      nativos.map(async (t) => {
        const r = await mandarAvisoFcm(t.token, {
          title: body.title!,
          body: body.body ?? '',
          url: destino,
          tag: body.tag,
        });
        if (r === 'ok') enviadas += 1;
        else if (r === 'vencido') tokensVencidos.push(t.id);
      }),
    );
  } else if (nativos.length > 0) {
    // Hay celulares con la app esperando avisos y el servidor no puede
    // mandarlos. Es la clase de cosa que se descubre tarde y mal, cuando un
    // repartidor dice que no le llegó nada.
    console.error('[notify] hay tokens de la app pero falta FIREBASE_SERVICE_ACCOUNT.');
  }

  if (vencidas.length > 0) {
    await admin.from('push_subscriptions').delete().in('id', vencidas);
    console.info(`[notify] ${vencidas.length} suscripción(es) vencida(s) dadas de baja.`);
  }

  if (tokensVencidos.length > 0) {
    await admin.from('push_tokens').delete().in('id', tokensVencidos);
    console.info(`[notify] ${tokensVencidos.length} token(s) de la app dados de baja.`);
  }

  return NextResponse.json({
    enviadas,
    vencidas: vencidas.length + tokensVencidos.length,
  });
}
