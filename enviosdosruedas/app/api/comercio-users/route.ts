import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * Alta, cambio de contraseña y baja del usuario con el que entra un comercio a
 * ver SUS ENVÍOS.
 *
 * Es hermana de `/api/stock-users`, que hace lo mismo para el stock. Están
 * separadas porque cuelgan de tablas distintas —`clients` acá, `stock_clients`
 * allá— y un comercio puede tener envíos sin tener stock. Juntarlas obligaría
 * a que las dos cosas existan siempre.
 *
 * CORRE EN EL SERVIDOR porque crear usuarios necesita la clave de servicio, y
 * esa clave no puede viajar al navegador ni una vez: quien la tenga puede leer
 * y escribir toda la base salteándose los permisos.
 *
 * El usuario queda con rol `comercio` y enganchado a la ficha por `profile_id`.
 * Ese enganche es el que usan las políticas del paso 49 para dejarlo ver lo
 * suyo y nada más.
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
    { status: 500 },
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

/**
 * El id de un usuario de comercio que existe pero no es de nadie.
 *
 * Devuelve null si no existe, si no es un comercio, o si ya hay una ficha
 * apuntándole. Sólo un usuario realmente huérfano se puede volver a atar.
 */
async function usuarioSuelto(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = data.users.find((u) => u.email === email);
  if (!user) return null;

  const { data: perfil } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (perfil?.role !== 'comercio') return null;

  const { count } = await admin
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', user.id);

  return (count ?? 0) === 0 ? user.id : null;
}

/* ------------------------------------------------- con qué usuario entra */
/**
 * El nombre de usuario del comercio, para poder mostrarlo en el panel.
 *
 * Tiene que salir de acá y no de una consulta común: el usuario vive en la
 * tabla de cuentas de Supabase, que sólo se lee con la clave de servicio. Sin
 * esto el panel podría decir "tiene acceso" pero no CUÁL, y entonces cuando el
 * comercio llama diciendo que no puede entrar, nadie sabe qué usuario darle.
 */
export async function GET(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });
  }

  const clientId = new URL(request.url).searchParams.get('client_id');
  if (!clientId) return NextResponse.json({ error: 'Falta el comercio.' }, { status: 400 });

  const { data: comercio } = await admin
    .from('clients')
    .select('profile_id')
    .eq('id', clientId)
    .single();

  if (!comercio?.profile_id) return NextResponse.json({ usuario: null });

  const { data, error } = await admin.auth.admin.getUserById(comercio.profile_id);

  /*
   * La ficha apunta a un usuario que ya no existe.
   *
   * Pasa si alguien borró la cuenta desde Supabase. Sin avisar de esto, el
   * panel diría "entra como …" para siempre y nadie entendería por qué el
   * comercio no puede entrar. Se dice que está roto y se deja crear uno nuevo.
   */
  if (error || !data.user) return NextResponse.json({ usuario: null, roto: true });

  // Se devuelve sin el "@enviosdosruedas.local": eso es de adentro, y el
  // comercio escribe sólo la primera parte para entrar.
  const email = data.user.email ?? '';
  return NextResponse.json({
    usuario: email.endsWith(`@${DOMAIN}`) ? email.slice(0, -(DOMAIN.length + 1)) : email,
    email,
  });
}

/* ------------------------------------------------------- crear el acceso */
export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede crear accesos de comercio.' },
      { status: 403 },
    );
  }

  const { client_id, username, password } = (await request.json()) ?? {};

  if (!client_id || !username?.trim() || !password?.trim()) {
    return NextResponse.json(
      { error: 'Faltan el comercio, el usuario o la contraseña.' },
      { status: 400 },
    );
  }
  if (String(password).length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 },
    );
  }

  const { data: comercio, error: clientError } = await admin
    .from('clients')
    .select('id, name, profile_id')
    .eq('id', client_id)
    .single();

  if (clientError || !comercio) {
    return NextResponse.json({ error: 'No encontré ese comercio.' }, { status: 404 });
  }
  if (comercio.profile_id) {
    return NextResponse.json(
      {
        error:
          'Ese comercio ya tiene un acceso creado. Cambiale la contraseña en vez de crear otro.',
      },
      { status: 400 },
    );
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: toEmail(username),
    password,
    email_confirm: true,
    user_metadata: { full_name: comercio.name },
  });

  if (authError) {
    if (!/already|registered|exists/i.test(authError.message)) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    /*
     * El usuario ya existe. Antes de rebotar hay que ver DE QUIÉN es.
     *
     * Si es una cuenta de comercio que no está atada a ninguna ficha, es este
     * mismo comercio que se quedó sin el vínculo —pasa si alguien borra y
     * vuelve a crear la ficha, o si el enlace se pierde—. Ahí lo que hace
     * falta no es una cuenta nueva sino volver a atar la que hay: crear otra
     * dejaría al comercio con dos usuarios y a nadie sabiendo cuál anda.
     *
     * Si en cambio es de otro comercio o de otra persona, se rebota: dos
     * negocios distintos no pueden entrar con el mismo usuario.
     */
    const suelto = await usuarioSuelto(admin, toEmail(username));

    if (!suelto) {
      return NextResponse.json(
        {
          error:
            'Ese nombre de usuario ya está tomado por otra cuenta. Elegí otro.',
        },
        { status: 400 },
      );
    }

    const { error: eAtar } = await admin
      .from('clients')
      .update({ profile_id: suelto })
      .eq('id', client_id);

    if (eAtar) return NextResponse.json({ error: eAtar.message }, { status: 400 });

    return NextResponse.json({ id: suelto, email: toEmail(username), reconectado: true });
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: created.user.id,
    full_name: comercio.name,
    role: 'comercio',
    active: true,
  });

  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  /*
   * El enganche va ÚLTIMO y si falla se deshace todo.
   *
   * Si quedara un usuario creado sin enganchar, esa persona podría entrar al
   * sistema y no ver absolutamente nada, sin que nadie sepa por qué: el
   * comercio jura que le dieron un acceso y desde el panel figura sin acceso.
   */
  const { error: linkError } = await admin
    .from('clients')
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
      { status: 403 },
    );
  }

  const { client_id, password, username } = (await request.json()) ?? {};
  if (!client_id) return NextResponse.json({ error: 'Falta el comercio.' }, { status: 400 });

  // Se puede cambiar la contraseña, el usuario, o los dos. Lo que no se puede
  // es llamar sin cambiar nada.
  if (!password && !username?.trim()) {
    return NextResponse.json({ error: 'No hay nada para cambiar.' }, { status: 400 });
  }
  if (password && String(password).length < 6) {
    return NextResponse.json(
      { error: 'La contraseña debe tener al menos 6 caracteres.' },
      { status: 400 },
    );
  }

  const { data: comercio } = await admin
    .from('clients')
    .select('profile_id')
    .eq('id', client_id)
    .single();

  if (!comercio?.profile_id) {
    return NextResponse.json(
      { error: 'Ese comercio todavía no tiene acceso creado.' },
      { status: 400 },
    );
  }

  const cambios: { password?: string; email?: string } = {};
  if (password) cambios.password = password;
  /*
   * Cambiar el usuario es cambiar el mail, y se confirma en el acto.
   *
   * Sin `email_confirm` Supabase deja el mail viejo andando hasta que alguien
   * abra un link de confirmación — y estos mails no existen, son inventados
   * para poder entrar con un usuario. El comercio se quedaría esperando un
   * correo que no va a llegar nunca.
   */
  if (username?.trim()) cambios.email = toEmail(username);

  const { error } = await admin.auth.admin.updateUserById(comercio.profile_id, {
    ...cambios,
    ...(cambios.email ? { email_confirm: true } : {}),
  });

  if (error) {
    const repetido = /already|registered|exists/i.test(error.message);
    return NextResponse.json(
      { error: repetido ? 'Ese usuario ya está tomado. Elegí otro.' : error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}

/* ---------------------------------------------------------- dar de baja */
export async function DELETE(request: Request) {
  const admin = getAdminClient();
  if (!admin) return missingKeys();

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json(
      { error: 'Solo un administrador puede eliminar accesos de comercio.' },
      { status: 403 },
    );
  }

  const { client_id } = (await request.json()) ?? {};
  if (!client_id) return NextResponse.json({ error: 'Falta el comercio.' }, { status: 400 });

  const { data: comercio } = await admin
    .from('clients')
    .select('profile_id')
    .eq('id', client_id)
    .single();

  if (!comercio?.profile_id) return NextResponse.json({ ok: true });

  /*
   * `profile_id` es `on delete set null`: borrar el usuario deja la ficha del
   * comercio y sus envíos intactos. Lo único que se cae es el acceso — que es
   * exactamente lo que se quiso hacer.
   */
  const { error } = await admin.auth.admin.deleteUser(comercio.profile_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
