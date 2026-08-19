import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { firmarEtiqueta } from '@/lib/etiquetaFirma';
import { etiquetaUrl } from '@/lib/etiquetaUrl';

/**
 * Arma los links firmados de las etiquetas.
 *
 * Existe porque la firma se calcula con un secreto que vive en el servidor: si
 * el panel la armara sola, ese secreto tendría que viajar al navegador y
 * cualquiera podría firmar la etiqueta de cualquier envío.
 *
 * La pide la oficina, y también el comercio desde su portal: el que despacha
 * el paquete es el que necesita la etiqueta pegada antes de que pasemos a
 * retirar. Cada uno sobre lo suyo (ver `susCodigos`). Los links que devuelve sí
 * se pueden compartir —para eso están— pero fabricarlos no.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let cached: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/**
 * Quién está pidiendo etiquetas.
 *
 * `null` si no hay sesión o si es un repartidor: él no imprime nada, retira lo
 * que ya está etiquetado.
 */
type Quien = { rol: 'admin' } | { rol: 'comercio'; userId: string } | null;

async function quienPide(request: Request, admin: SupabaseClient): Promise<Quien> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: perfil } = await admin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  if (perfil?.role === 'admin') return { rol: 'admin' };
  if (perfil?.role === 'comercio') return { rol: 'comercio', userId: data.user.id };
  return null;
}

/**
 * De qué códigos puede pedir etiqueta un comercio: los de SUS envíos.
 *
 * SE COMPRUEBA ACÁ Y NO CON LOS PERMISOS DE LA BASE. Esta ruta corre con la
 * clave de servicio —la necesita para firmar— y esa clave se saltea las
 * políticas. Si no se preguntara de quién es cada envío, un comercio podría
 * pedir la etiqueta de cualquier código y llevarse el teléfono y el monto a
 * cobrar del cliente de otro. Los códigos son correlativos: probarlos es
 * contar.
 *
 * Incluye las sucursales, igual que el resto del portal: para el dueño es un
 * solo negocio.
 */
async function susCodigos(
  admin: SupabaseClient,
  userId: string,
  codigos: string[],
): Promise<string[]> {
  const { data: propio } = await admin
    .from('clients')
    .select('id')
    .eq('profile_id', userId)
    .maybeSingle();

  if (!propio) return [];

  const { data: hijas } = await admin.from('clients').select('id').eq('parent_id', propio.id);
  const mios = [propio.id, ...((hijas ?? []) as { id: number }[]).map((c) => c.id)];

  const { data: envios } = await admin
    .from('shipments')
    .select('tracking_code')
    .in('client_id', mios)
    .in('tracking_code', codigos);

  return ((envios ?? []) as { tracking_code: string }[]).map((s) => s.tracking_code);
}

export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Falta configurar el servidor.' }, { status: 500 });
  }

  const quien = await quienPide(request, admin);
  if (!quien) {
    return NextResponse.json(
      { error: 'Sólo la oficina o un comercio pueden pedir etiquetas.' },
      { status: 403 },
    );
  }

  const { codigos } = (await request.json().catch(() => ({}))) as { codigos?: string[] };

  if (!Array.isArray(codigos) || codigos.length === 0) {
    return NextResponse.json({ error: 'Faltan los códigos.' }, { status: 400 });
  }

  // Un tope por las dudas: nadie manda mil etiquetas en un mensaje de WhatsApp,
  // y sin límite esto sería una forma cómoda de hacer trabajar al servidor.
  const pedidos = codigos.slice(0, 100);

  /*
   * La oficina pide las que quiera; el comercio, sólo las suyas.
   *
   * Los que no son suyos se descartan en silencio y el resto sale igual. Se
   * eligió eso y no rechazar todo porque el único que puede llegar acá con un
   * código ajeno es alguien probando: al que trabaja no le va a pasar nunca, y
   * si le pasara —una lista con un envío que la oficina le movió a otro
   * comercio— es mejor que le salgan las nueve etiquetas que ninguna.
   */
  const permitidos =
    quien.rol === 'admin' ? pedidos : await susCodigos(admin, quien.userId, pedidos);

  if (permitidos.length === 0) {
    return NextResponse.json(
      { error: 'Ninguno de esos envíos es tuyo.' },
      { status: 403 },
    );
  }

  const links = permitidos.map((codigo) => ({
    codigo,
    url: etiquetaUrl(codigo, firmarEtiqueta(codigo)),
  }));

  return NextResponse.json({ links });
}
