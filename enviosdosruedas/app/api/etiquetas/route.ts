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
 * Sólo para administradores. Los links que devuelve sí se pueden compartir —
 * para eso están— pero fabricarlos es una decisión de quien maneja el sistema.
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

async function esAdmin(request: Request, admin: SupabaseClient) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return false;

  const { data: perfil } = await admin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  return perfil?.role === 'admin';
}

export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Falta configurar el servidor.' }, { status: 500 });
  }

  if (!(await esAdmin(request, admin))) {
    return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });
  }

  const { codigos } = (await request.json().catch(() => ({}))) as { codigos?: string[] };

  if (!Array.isArray(codigos) || codigos.length === 0) {
    return NextResponse.json({ error: 'Faltan los códigos.' }, { status: 400 });
  }

  // Un tope por las dudas: nadie manda mil etiquetas en un mensaje de WhatsApp,
  // y sin límite esto sería una forma cómoda de hacer trabajar al servidor.
  const links = codigos.slice(0, 100).map((codigo) => ({
    codigo,
    url: etiquetaUrl(codigo, firmarEtiqueta(codigo)),
  }));

  return NextResponse.json({ links });
}
