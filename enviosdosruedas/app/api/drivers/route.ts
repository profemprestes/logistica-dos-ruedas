import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Crear usuarios en Supabase requiere la clave service_role, que NUNCA puede
 * viajar al navegador. Por eso esta parte corre en el servidor.
 *
 * Necesita en .env.local (y en las variables de entorno de Vercel):
 *   SUPABASE_SERVICE_ROLE_KEY=...   (sin NEXT_PUBLIC_ adelante, es secreta)
 *
 * El cliente se crea recién cuando alguien llama a la ruta, no al compilar:
 * así, si falta una clave, se ve un mensaje claro en vez de romper el build.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DOMAIN = 'enviosdosruedas.local';
const toEmail = (username: string) =>
  username.includes('@')
    ? username.trim().toLowerCase()
    : `${username.trim().toLowerCase()}@${DOMAIN}`;

let cached: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const missingKeys = () =>
  NextResponse.json(
    {
      error:
        'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor. Cargala en las variables de entorno y volvé a publicar.',
    },
    { status: 500 }
  );

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

/* ------------------------------------------------------------------ crear */
export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede crear repartidores.' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { full_name, username, password, phone, vehicle } = body ?? {};

  if (!full_name?.trim() || !username?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: 'Nombre, usuario y contraseña son obligatorios.' },
      { status: 400 }
    );
  }
  if (String(password).length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    );
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: toEmail(username),
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (authError) {
    const already = /already|registered|exists/i.test(authError.message);
    return NextResponse.json(
      { error: already ? 'Ese usuario ya existe. Elegí otro.' : authError.message },
      { status: 400 }
    );
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: created.user.id,
    full_name,
    phone: phone ?? null,
    vehicle: vehicle ?? null,
    role: 'repartidor',
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  return NextResponse.json({ id: created.user.id, email: toEmail(username) });
}

/* ---------------------------------------------------------------- editar */
export async function PATCH(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede editar repartidores.' },
      { status: 403 }
    );
  }

  const { id, full_name, phone, vehicle, active, password } = (await request.json()) ?? {};
  if (!id) return NextResponse.json({ error: 'Falta el repartidor.' }, { status: 400 });

  if (password) {
    if (String(password).length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres.' },
        { status: 400 }
      );
    }
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (full_name !== undefined) patch.full_name = full_name;
  if (phone !== undefined) patch.phone = phone;
  if (vehicle !== undefined) patch.vehicle = vehicle;
  if (active !== undefined) patch.active = active;

  if (Object.keys(patch).length) {
    const { error } = await admin.from('profiles').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

/* ---------------------------------------------------------------- borrar */
export async function DELETE(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede eliminar repartidores.' },
      { status: 403 }
    );
  }

  const { id } = (await request.json()) ?? {};
  if (!id) return NextResponse.json({ error: 'Falta el repartidor.' }, { status: 400 });

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
