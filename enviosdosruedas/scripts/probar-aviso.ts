/**
 * Manda una notificación de prueba al celular de un repartidor.
 *
 *   npm run aviso                → lista quién tiene la app instalada
 *   npm run aviso -- "Emiliano"  → le manda un aviso a ese
 *
 * PARA QUÉ. Cuando un repartidor dice "no me llega nada", hay cinco lugares
 * donde puede estar cortado: el permiso en el celular, el token guardado, la
 * credencial del servidor, Firebase, o el celular apagado. Probarlo desde el
 * panel mezcla todo eso con la lógica de asignar un envío. Esto prueba
 * únicamente el camino servidor → teléfono, que es donde suele estar el
 * problema, y dice en qué escalón se cayó.
 *
 * Usa exactamente el mismo código que el sistema en producción (`lib/server/
 * firebase.ts`): si esto anda y el aviso real no llega, el problema no está en
 * el envío.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Los scripts no pasan por Next, así que las variables se leen a mano.
for (const linea of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const corte = linea.indexOf('=');
  if (corte > 0 && !linea.startsWith('#')) {
    process.env[linea.slice(0, corte).trim()] ??= linea.slice(corte + 1).trim();
  }
}

async function main() {
  const { hayFirebase, mandarAvisoFcm } = await import('../lib/server/firebase');

  if (!hayFirebase()) {
    console.error('Falta FIREBASE_SERVICE_ACCOUNT en .env.local. Sin eso no se puede mandar nada.');
    process.exit(1);
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data } = await db
    .from('push_tokens')
    .select('token, device, created_at, perfil:driver_id(full_name)');

  type Fila = { token: string; device: string | null; perfil: { full_name: string } | null };
  const filas = (data ?? []) as unknown as Fila[];

  if (!filas.length) {
    console.log('Ninguno activó las notificaciones en la app todavía.');
    return;
  }

  const quien = process.argv[2];

  if (!quien) {
    console.log('Celulares con la app y los avisos activados:\n');
    for (const f of filas) console.log(`  ${f.perfil?.full_name ?? '?'} · ${f.device ?? ''}`);
    console.log('\nPara mandarle uno:  npm run aviso -- "Nombre"');
    return;
  }

  const elegidos = filas.filter((f) =>
    (f.perfil?.full_name ?? '').toLowerCase().includes(quien.toLowerCase()),
  );

  if (!elegidos.length) {
    console.log(`No hay ningún celular de "${quien}".`);
    return;
  }

  for (const f of elegidos) {
    const r = await mandarAvisoFcm(f.token, {
      title: 'Prueba de aviso',
      body: 'Si ves esto, las notificaciones de la app funcionan.',
      url: '/driver/dashboard',
      tag: 'prueba',
    });

    const explicacion =
      r === 'ok'
        ? 'salió · tiene que sonar el celular'
        : r === 'vencido'
          ? 'el token ya no sirve: reinstaló la app o la desinstaló. Que vuelva a activarlos.'
          : 'falló el envío. El motivo está arriba, lo escribe lib/server/firebase.ts';

    console.log(`  ${f.perfil?.full_name ?? '?'} → ${explicacion}`);
  }
}

main();
