import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Alta y cambio de contraseña del usuario con el que entra un comercio a ver su
 * stock. Igual que `/api/drivers`: crear usuarios pide la clave service_role,
 * que nunca puede viajar al navegador, así que esta parte corre en el servidor.
 *
 * El usuario queda con rol `comercio` y enganchado a su ficha de
 * `stock_clients` por `profile_id`. Ese enganche es el que usan las políticas
 * del paso 13 para dejarlo ver lo suyo y nada más.
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

/* ------------------------------------------------------- crear el acceso */
export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede crear accesos de comercio.' },
      { status: 403 }
    );
  }

  const { client_id, username, password } = (await request.json()) ?? {};

  if (!client_id || !username?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: 'Faltan el cliente, el usuario o la contraseña.' },
      { status: 400 }
    );
  }
  if (String(password).length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    );
  }

  const { data: cliente, error: clientError } = await admin
    .from('stock_clients')
    .select('id, nombre, profile_id')
    .eq('id', client_id)
    .single();

  if (clientError || !cliente) {
    return NextResponse.json({ error: 'No encontré ese cliente.' }, { status: 404 });
  }
  if (cliente.profile_id) {
    return NextResponse.json(
      { error: 'Ese cliente ya tiene un acceso creado. Cambiale la contraseña en vez de crear otro.' },
      { status: 400 }
    );
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: toEmail(username),
    password,
    email_confirm: true,
    user_metadata: { full_name: cliente.nombre },
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
    full_name: cliente.nombre,
    role: 'comercio',
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  // El enganche va último: si algo falla antes, no queda una ficha apuntando a
  // un usuario a medio crear.
  const { error: linkError } = await admin
    .from('stock_clients')
    .update({ profile_id: created.user.id })
    .eq('id', client_id);

  if (linkError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: linkError.message }, { status: 400 });
  }

  return NextResponse.json({ id: created.user.id, email: toEmail(username) });
}

/* -------------------------------------------------- cambiar la contraseña */
export async function PATCH(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede cambiar la contraseña de un comercio.' },
      { status: 403 }
    );
  }

  const { client_id, password } = (await request.json()) ?? {};
  if (!client_id || !password) {
    return NextResponse.json({ error: 'Faltan el cliente o la contraseña.' }, { status: 400 });
  }
  if (String(password).length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 }
    );
  }

  const { data: cliente } = await admin
    .from('stock_clients')
    .select('profile_id')
    .eq('id', client_id)
    .single();

  if (!cliente?.profile_id) {
    return NextResponse.json(
      { error: 'Ese cliente todavía no tiene acceso creado.' },
      { status: 400 }
    );
  }

  const { error } = await admin.auth.admin.updateUserById(cliente.profile_id, { password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

/* ---------------------------------------------------------- dar de baja */
export async function DELETE(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede eliminar accesos de comercio.' },
      { status: 403 }
    );
  }

  const { client_id } = (await request.json()) ?? {};
  if (!client_id) return NextResponse.json({ error: 'Falta el cliente.' }, { status: 400 });

  const { data: cliente } = await admin
    .from('stock_clients')
    .select('profile_id')
    .eq('id', client_id)
    .single();

  if (!cliente?.profile_id) return NextResponse.json({ ok: true });

  // `profile_id` es `on delete set null`: borrar el usuario deja la ficha y el
  // stock intactos, sólo se cae el acceso.
  const { error } = await admin.auth.admin.deleteUser(cliente.profile_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
