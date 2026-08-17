/**
 * Carga la lista de comercios desde los envíos que ya existen.
 *
 *   npm run comercios          → muestra qué haría, sin tocar nada
 *   npm run comercios -- ya    → lo hace
 *
 * SE CORRE UNA VEZ. Después los comercios nacen solos al cargar un envío con
 * un nombre nuevo. Esto existe para no arrancar con la lista vacía teniendo
 * cincuenta envíos cargados que ya dicen dónde se retira cada cosa.
 *
 * QUÉ HACE, en orden:
 *  1. Junta los envíos por dirección de retiro, normalizada.
 *  2. Une los que son el mismo comercio escrito distinto (ver ALIAS).
 *  3. Le busca el punto a cada uno.
 *  4. Los crea y engancha los envíos viejos a su comercio.
 *
 * Es idempotente: correrlo dos veces no duplica nada, porque los comercios
 * tienen el nombre único (paso 40) y los envíos se enganchan por igualdad.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { buscarPunto } from '../lib/geocode';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

/**
 * Los que son el mismo comercio escrito de dos formas.
 *
 * Salieron de mirar el historial, no de adivinar: TOY PIOLA y TOYPIOLA es el
 * mismo lugar, y BELGRANO 2875 con y sin el piso también. Si aparecen más, se
 * agregan acá y se vuelve a correr.
 */
const ALIAS: Record<string, string> = {
  toypiola: 'toy piola',
  'belgrano 2875 5a': 'belgrano 2875',
};

/** Sin tildes, sin dobles espacios, en minúscula. Para comparar, no para mostrar. */
const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Basura de pruebas que no es un comercio. */
const esBasura = (s: string) => /^(prueba|esto es prueba|test)$/i.test(s.trim());

interface Comercio {
  nombre: string;
  direccion: string;
  notas: string | null;
  envios: number[];
}

async function main() {
  const enSerio = process.argv[2] === 'ya';

  const { data, error } = await db
    .from('shipments')
    .select('id, client_name_raw, pickup_address, pickup_notes')
    .not('pickup_address', 'is', null)
    .order('id', { ascending: false })
    .limit(1000);

  if (error) return console.error('no se pudieron leer los envíos:', error.message);

  /*
   * Se agrupa por NOMBRE y no por dirección.
   *
   * Parece al revés pero es lo correcto: dos comercios pueden compartir
   * dirección —una galería, un edificio con locales— y ahí agrupar por
   * dirección los fusionaría en uno. El nombre es lo que el que carga escribe
   * pensando en "de quién es este paquete".
   */
  const porNombre = new Map<string, Comercio>();

  for (const s of data ?? []) {
    const nombre = String(s.client_name_raw ?? '').trim();
    const direccion = String(s.pickup_address ?? '').trim();
    if (!nombre || !direccion || esBasura(nombre) || esBasura(direccion)) continue;

    const clave = ALIAS[normalizar(nombre)] ?? normalizar(nombre);
    const previo = porNombre.get(clave);

    porNombre.set(clave, {
      // Se queda con el nombre más largo: entre TOY PIOLA y TOYPIOLA, el que
      // tiene el espacio se lee mejor.
      nombre: !previo || nombre.length > previo.nombre.length ? nombre : previo.nombre,
      direccion: previo?.direccion ?? direccion,
      notas: previo?.notas ?? (s.pickup_notes ? String(s.pickup_notes).trim() : null),
      envios: [...(previo?.envios ?? []), s.id as number],
    });
  }

  const comercios = [...porNombre.values()].sort((a, b) => b.envios.length - a.envios.length);

  console.log(`\n  ${comercios.length} comercios salen de ${data?.length ?? 0} envíos\n`);

  for (const c of comercios) {
    console.log(
      `  ${String(c.envios.length).padStart(3)} envíos · ${c.nombre.padEnd(24)} · ${c.direccion}`,
    );
  }

  if (!enSerio) {
    console.log('\n  Esto fue sólo mirar. Para hacerlo:  npm run comercios -- ya\n');
    return;
  }

  console.log('\n  --- buscando los puntos y cargando ---\n');

  for (const c of comercios) {
    // Nominatim pide no golpearlo: una consulta por segundo.
    const punto = await buscarPunto(c.direccion, 'Mar del Plata').catch(() => null);
    await new Promise((r) => setTimeout(r, 1100));

    const { data: creado, error: e } = await db
      .from('clients')
      .upsert(
        {
          name: c.nombre,
          pickup_address: c.direccion,
          pickup_notes: c.notas,
          lat: punto?.lat ?? null,
          lng: punto?.lng ?? null,
          active: true,
        },
        { onConflict: 'name' },
      )
      .select('id')
      .single();

    if (e) {
      console.log(`  ${c.nombre.padEnd(24)} NO SE PUDO: ${e.message}`);
      continue;
    }

    // Los envíos viejos quedan enganchados a su comercio. Sirve para el mapa y
    // para poder preguntar "cuántos envíos hizo este comercio" sin comparar
    // textos escritos a mano.
    const { error: e2 } = await db
      .from('shipments')
      .update({ client_id: creado.id })
      .in('id', c.envios);

    console.log(
      `  ${c.nombre.padEnd(24)} ${punto ? 'con punto' : 'SIN PUNTO'} · ${c.envios.length} envíos${
        e2 ? ' (no se pudieron enganchar: ' + e2.message + ')' : ''
      }`,
    );
  }

  const { count } = await db.from('clients').select('id', { count: 'exact', head: true });
  console.log(`\n  quedaron ${count} comercios cargados.`);
  console.log('  Los que digan SIN PUNTO hay que ubicarlos a mano desde el panel.\n');
}

main();
