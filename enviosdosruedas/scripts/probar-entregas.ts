/**
 * Las reglas de un envío con varias entregas, escritas en pruebas.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/probar-entregas.ts
 *
 * Dos mitades. La primera prueba el agrupado y la cuenta de la plata sin tocar
 * nada: son funciones puras y se pueden correr siempre. La segunda prueba lo
 * que hace la BASE —los disparadores del paso 53— y para eso crea dos envíos de
 * prueba de verdad.
 *
 * LO QUE CREA, LO BORRA POR ID. Nunca "todo lo que cumpla X": él trabaja en
 * vivo y un borrado por condición se lleva puesto trabajo real. Si el script se
 * corta a la mitad, los ids quedan escritos en pantalla para borrarlos a mano.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import type { Entrega } from '../lib/entregas';
import type { DeliveryLog } from '../lib/settlement';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

/*
 * Las variables van a `process.env` ANTES de cargar las librerías.
 *
 * `lib/entregas` arrastra el cliente del navegador, que las busca ahí al
 * cargarse y protesta si no están. Por eso las dos librerías se traen con
 * `import()` adentro de `main` y no arriba: los `import` de arriba corren antes
 * que cualquier línea de este archivo.
 */
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let agrupar: typeof import('../lib/entregas').agrupar;
let sinPrecio: typeof import('../lib/settlement').sinPrecio;
let summarizeLogs: typeof import('../lib/settlement').summarizeLogs;

let bien = 0;
let mal = 0;

function comprobar(que: string, condicion: boolean, detalle = '') {
  if (condicion) {
    bien++;
    console.log(`  ok   ${que}`);
  } else {
    mal++;
    console.log(`  MAL  ${que}${detalle ? ` · ${detalle}` : ''}`);
  }
}

function titulo(t: string) {
  console.log(`\n=== ${t} ===`);
}

/* ------------------------------------------------------------------ puras */

function entrega(id: number, parte_de: number | null, fee = 0): Entrega {
  return {
    id,
    tracking_code: `EDR${String(id).padStart(8, '0')}MDQ`,
    address_street: `CALLE ${id}`,
    recipient_name: null,
    status: 'pendiente_retiro',
    parte_de,
    shipping_fee: fee,
    scheduled_date: '2026-08-21',
  };
}

function mapa(...es: Entrega[]) {
  return new Map(es.map((e) => [e.id, e]));
}

function probarAgrupado() {
  titulo('Agrupar entregas');

  const solo = agrupar(mapa(entrega(1, null, 5300)));
  comprobar('un envío de una entrega no es un grupo', solo.size === 0);

  const dos = agrupar(mapa(entrega(1, null, 5300), entrega(2, 1)));
  comprobar('dos entregas atadas forman un grupo', dos.size === 2);
  comprobar('la cabeza va primera', dos.get(1)?.numero === 1 && dos.get(1)?.esCabeza === true);
  comprobar('la otra va segunda', dos.get(2)?.numero === 2 && dos.get(2)?.esCabeza === false);
  comprobar('las dos dicen "de 2"', dos.get(1)?.total === 2 && dos.get(2)?.total === 2);

  const tres = agrupar(mapa(entrega(1, null, 5300), entrega(2, 1), entrega(3, 1)));
  comprobar('tres entregas cuentan tres', tres.get(3)?.total === 3);
  comprobar('la tercera va tercera', tres.get(3)?.numero === 3);

  // El orden de carga manda, no el orden en que vinieron de la base.
  const desordenado = agrupar(mapa(entrega(3, 1), entrega(2, 1), entrega(1, null, 5300)));
  comprobar(
    'las paradas van en el orden en que se cargaron',
    desordenado.get(1)?.numero === 1 &&
      desordenado.get(2)?.numero === 2 &&
      desordenado.get(3)?.numero === 3,
  );

  // Una parte cuya cabeza no está a la vista no muestra cartel: es preferible
  // no decir nada a decir "entrega 2 de 1".
  const huerfana = agrupar(mapa(entrega(2, 1)));
  comprobar('una parte sin su cabeza a la vista no arma grupo', huerfana.size === 0);

  // Dos envíos distintos, cada uno con dos entregas, no se mezclan.
  const dosEnvios = agrupar(
    mapa(entrega(1, null, 5300), entrega(2, 1), entrega(10, null, 4000), entrega(11, 10)),
  );
  comprobar('dos envíos con dos entregas no se mezclan', dosEnvios.size === 4);
  comprobar(
    'cada uno cuenta las suyas',
    dosEnvios.get(2)?.total === 2 && dosEnvios.get(11)?.total === 2,
  );
  comprobar(
    'cada uno apunta a su cabeza',
    dosEnvios.get(2)?.grupo.cabeza === 1 && dosEnvios.get(11)?.grupo.cabeza === 10,
  );
}

/* ------------------------------------------------------- la plata del día */

function log(id: number, fee: number, parte_de: number | null): DeliveryLog {
  return {
    id: `log-${id}`,
    event: 'entregado',
    amount_collected: 0,
    happened_at: '2026-08-21T15:00:00Z',
    failure_reason: null,
    shipment: {
      id,
      tracking_code: `EDR${id}`,
      recipient_name: 'X',
      address_street: 'CALLE',
      amount_to_collect: 0,
      payment_mode: 'pagado',
      shipping_fee: fee,
      client_name_raw: 'EL CONDOR',
      parte_de,
    },
  };
}

function probarLaPlata() {
  titulo('La plata: un envío, un precio');

  comprobar('un envío suelto en $ 0 sí es un olvido', sinPrecio(log(1, 0, null)) === true);
  comprobar('una entrega atada en $ 0 NO es un olvido', sinPrecio(log(2, 0, 1)) === false);
  comprobar('un envío con precio nunca es un olvido', sinPrecio(log(3, 5300, null)) === false);

  // Dos entregas del mismo envío: se factura una sola vez.
  const viernes = summarizeLogs([log(1, 5300, null), log(2, 0, 1)]);
  comprobar('dos entregas facturan un solo envío', viernes.shippingTotal === 5300, `dio ${viernes.shippingTotal}`);
  comprobar('no avisa de precios faltantes', viernes.shippingMissing === 0, `dio ${viernes.shippingMissing}`);
  comprobar(
    'al repartidor le queda el 70% de ese envío',
    viernes.driverEarnings === Math.round(5300 * 0.7),
    `dio ${viernes.driverEarnings}`,
  );

  // Y si de verdad falta un precio, sigue avisando.
  const conOlvido = summarizeLogs([log(1, 5300, null), log(2, 0, 1), log(9, 0, null)]);
  comprobar('un olvido de verdad sigue saltando', conOlvido.shippingMissing === 1);
}

/* -------------------------------------------------------------- la base */

interface Creado {
  ids: number[];
}

async function hayColumna(): Promise<boolean> {
  const { error } = await db.from('shipments').select('id, parte_de').limit(1);
  return !error;
}

async function crearEnvio(clientId: number, calle: string, fee: number): Promise<number> {
  const { data, error } = await db
    .from('shipments')
    .insert({
      client_id: clientId,
      client_name_raw: 'ZZ PRUEBA ENTREGAS',
      pickup_address: 'PRUEBA',
      recipient_name: 'ZZ PRUEBA',
      address_street: calle,
      city: 'Mar del Plata',
      scheduled_date: '2026-01-01',
      status: 'pendiente_retiro',
      payment_mode: 'pagado',
      shipping_fee: fee,
      merchandise_amount: 0,
      amount_to_collect: 0,
    })
    .select('id')
    .single();

  if (error) throw new Error(`no se pudo crear el envío de prueba: ${error.message}`);
  return data.id as number;
}

async function probarLaBase(creado: Creado) {
  titulo('Los disparadores del paso 53');

  // Dos comercios distintos para poder probar que no se pueden mezclar.
  const { data: fichas } = await db.from('clients').select('id').order('id').limit(2);
  const [a, b] = (fichas ?? []).map((c) => c.id as number);
  if (!a || !b) throw new Error('hacen falta al menos dos comercios para probar esto');

  const cabeza = await crearEnvio(a, 'PRUEBA UNO 100', 5300);
  creado.ids.push(cabeza);
  const parte = await crearEnvio(a, 'PRUEBA DOS 200', 0);
  creado.ids.push(parte);
  const ajena = await crearEnvio(b, 'PRUEBA TRES 300', 0);
  creado.ids.push(ajena);

  const atar = (id: number, aQuien: number | null) =>
    db.from('shipments').update({ parte_de: aQuien }).eq('id', id);

  comprobar('se puede atar una entrega a otra del mismo comercio', !(await atar(parte, cabeza)).error);

  const otroComercio = await atar(ajena, cabeza);
  comprobar(
    'no se puede atar una entrega de otro comercio',
    Boolean(otroComercio.error),
    otroComercio.error ? '' : 'la dejó pasar',
  );

  const aSiMisma = await atar(cabeza, cabeza);
  comprobar('un envío no puede ser parte de sí mismo', Boolean(aSiMisma.error));

  const tercera = await crearEnvio(a, 'PRUEBA CUATRO 400', 0);
  creado.ids.push(tercera);
  const cadena = await atar(tercera, parte);
  comprobar(
    'no se arma una cadena: todo cuelga de la primera',
    Boolean(cadena.error),
    cadena.error ? '' : 'dejó colgar una parte de otra parte',
  );

  // --- reintento hereda el vínculo ---
  const { data: reintento, error: eR } = await db
    .from('shipments')
    .insert({
      client_id: a,
      client_name_raw: 'ZZ PRUEBA ENTREGAS',
      pickup_address: 'PRUEBA',
      recipient_name: 'ZZ PRUEBA',
      address_street: 'PRUEBA DOS 200',
      city: 'Mar del Plata',
      scheduled_date: '2026-01-02',
      status: 'pendiente_retiro',
      payment_mode: 'pagado',
      shipping_fee: 0,
      merchandise_amount: 0,
      amount_to_collect: 0,
      reintento_de: parte,
    })
    .select('id, parte_de')
    .single();

  if (eR) throw new Error(`no se pudo crear el reintento: ${eR.message}`);
  creado.ids.push(reintento.id as number);
  comprobar(
    'una entrega reprogramada sigue siendo parte del mismo envío',
    reintento.parte_de === cabeza,
    `quedó en ${reintento.parte_de}`,
  );

  // --- al borrar la cabeza, el precio no se pierde ---
  const { error: eBorrar } = await db.from('shipments').delete().eq('id', cabeza);
  comprobar('se puede borrar la cabeza', !eBorrar, eBorrar?.message ?? '');
  creado.ids = creado.ids.filter((id) => id !== cabeza);

  const { data: quedaron } = await db
    .from('shipments')
    .select('id, parte_de, shipping_fee')
    .in('id', [parte, reintento.id]);

  const heredera = (quedaron ?? []).find((s) => s.id === parte);
  const laOtra = (quedaron ?? []).find((s) => s.id === reintento.id);

  comprobar(
    'la primera que queda hereda el precio',
    Number(heredera?.shipping_fee) === 5300,
    `quedó en ${heredera?.shipping_fee}`,
  );
  comprobar('y pasa a ser la cabeza', heredera?.parte_de === null);
  comprobar(
    'las demás se le cuelgan a ella',
    laOtra?.parte_de === parte,
    `quedó colgada de ${laOtra?.parte_de}`,
  );
}

async function limpiar(creado: Creado) {
  if (!creado.ids.length) return;
  // De atrás para adelante: las partes antes que su cabeza, así ningún
  // disparador tiene que salir a heredar nada.
  for (const id of [...creado.ids].reverse()) {
    await db.from('shipments').delete().eq('id', id);
  }
  const { data } = await db.from('shipments').select('id').in('id', creado.ids);
  console.log(
    `\nborrados los ${creado.ids.length} envíos de prueba · quedan ${(data ?? []).length}`,
  );
}

async function main() {
  ({ agrupar } = await import('../lib/entregas'));
  ({ sinPrecio, summarizeLogs } = await import('../lib/settlement'));

  probarAgrupado();
  probarLaPlata();

  const creado: Creado = { ids: [] };

  if (await hayColumna()) {
    try {
      await probarLaBase(creado);
    } finally {
      await limpiar(creado);
    }
  } else {
    titulo('Los disparadores del paso 53');
    console.log('  (salteado: falta correr sql/paso53 en la base)');
  }

  console.log(`\n${bien} bien, ${mal} mal`);
  if (creado.ids.length) console.log(`ids creados: ${creado.ids.join(', ')}`);
  process.exit(mal ? 1 : 0);
}

main().catch(async (e) => {
  console.error('\nse cortó:', e instanceof Error ? e.message : e);
  process.exit(1);
});
