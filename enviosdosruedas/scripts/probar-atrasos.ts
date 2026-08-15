/**
 * Prueba las cuatro reglas de atraso del Panel del día.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/probar-atrasos.ts
 *
 * Dos partes. Primero casos armados a mano, donde se sabe qué tiene que dar:
 * es la única forma de probar "a las 15 hs todavía sin retirar" sin esperar a
 * las tres de la tarde. Después, contra la base de verdad, para ver qué
 * mostraría el panel hoy — que un aviso salte cuando no corresponde se nota
 * enseguida, pero uno que NO salta no deja rastro en ningún lado.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buscarAtrasos } from '../lib/admin/atrasos';
import type { Shipment } from '../lib/format';

// ---------------------------------------------------------------- casos armados

const HOY = '2026-08-14';

function envio(p: Partial<Shipment>): Shipment {
  return {
    id: 1,
    tracking_code: 'EDR00000001MDQ',
    status: 'creado',
    client_id: null,
    client_name_raw: 'Comercio',
    pickup_address: null,
    pickup_notes: null,
    recipient_name: 'Quien sea',
    recipient_phone: null,
    address_street: 'Falucho 1832',
    address_extra: null,
    city: 'Mar del Plata',
    notes: null,
    delivery_window: null,
    product_detail: null,
    payment_mode: 'no_cobrar',
    shipping_fee: 0,
    merchandise_amount: 0,
    amount_to_collect: 0,
    assigned_driver: null,
    scheduled_date: HOY,
    created_at: `${HOY}T09:10:00`,
    ...p,
  } as Shipment;
}

let fallas = 0;

function caso(nombre: string, obtenido: string[], esperado: string[]) {
  const ok =
    obtenido.length === esperado.length && obtenido.every((t, i) => t === esperado[i]);
  if (!ok) fallas++;
  console.log(`${ok ? '  ok  ' : 'FALLA '} ${nombre}`);
  if (!ok) {
    console.log(`         esperaba: ${esperado.join(', ') || '(nada)'}`);
    console.log(`         dio:      ${obtenido.join(', ') || '(nada)'}`);
  }
}

function tipos(envios: Shipment[], hora: number, enCamino: [number, number][] = []) {
  const ahora = new Date(`${HOY}T${String(hora).padStart(2, '0')}:00:00`);
  return buscarAtrasos({
    envios,
    enCaminoDesde: new Map(enCamino),
    ahora,
    hoy: HOY,
  }).map((a) => a.tipo);
}

console.log('\n=== casos armados ===\n');

caso('un envío recién cargado, sin asignar, a las 10', tipos([envio({})], 10), ['sin_asignar']);

caso(
  'asignado y sin retirar, pero recién cargado y son las 10',
  tipos([envio({ assigned_driver: 'd1', created_at: `${HOY}T09:40:00` })], 10),
  [],
);

caso(
  'asignado y sin retirar a las 16: pasó el corte',
  tipos([envio({ assigned_driver: 'd1', created_at: `${HOY}T15:40:00` })], 16),
  ['sin_retirar'],
);

caso(
  'asignado a las 6 y a las 11 sigue sin retirar: cinco horas',
  tipos([envio({ assigned_driver: 'd1', created_at: `${HOY}T06:00:00` })], 11),
  ['sin_retirar'],
);

caso(
  'ya retirado a las 16: no es un atraso de retiro',
  tipos([envio({ assigned_driver: 'd1', status: 'retirado' })], 16),
  [],
);

caso(
  'en camino hace 40 minutos',
  tipos(
    [envio({ id: 7, assigned_driver: 'd1', status: 'en_camino' })],
    12,
    [[7, Date.parse(`${HOY}T11:20:00`)]],
  ),
  [],
);

caso(
  'en camino hace 100 minutos',
  tipos(
    [envio({ id: 7, assigned_driver: 'd1', status: 'en_camino' })],
    13,
    [[7, Date.parse(`${HOY}T11:20:00`)]],
  ),
  ['demorado'],
);

caso(
  'en camino sin hora de salida: no se inventa',
  tipos([envio({ id: 7, assigned_driver: 'd1', status: 'en_camino' })], 13),
  [],
);

caso(
  'no entregado y sin reprogramar, de anteayer',
  tipos([envio({ status: 'pendiente_entrega', scheduled_date: '2026-08-12' })], 10),
  ['sin_reprogramar'],
);

caso(
  'no entregado PERO ya reprogramado',
  tipos(
    [envio({ status: 'pendiente_entrega', scheduled_date: '2026-08-12', reprogramado_en: 99 })],
    10,
  ),
  [],
);

caso('entregado: nunca es un atraso', tipos([envio({ status: 'entregado' })], 18), []);
caso('cancelado: tampoco', tipos([envio({ status: 'cancelado' })], 18), []);
caso('programado para mañana: todavía no es problema', tipos([envio({ scheduled_date: '2026-08-15' })], 18), []);

caso(
  'seis sin asignar son UN aviso, no seis',
  tipos(
    Array.from({ length: 6 }, (_, i) => envio({ id: i + 1, tracking_code: `EDR${i}` })),
    10,
  ),
  ['sin_asignar'],
);

caso(
  'los rojos van antes que los naranjas',
  tipos(
    [
      envio({ id: 1, assigned_driver: 'd1', created_at: `${HOY}T06:00:00` }),
      envio({ id: 2, status: 'pendiente_entrega', scheduled_date: '2026-08-12' }),
    ],
    11,
  ),
  ['sin_reprogramar', 'sin_retirar'],
);

// ------------------------------------------------------------------ base real

async function contraLaBase() {
  console.log('\n=== contra la base de verdad ===\n');

  const env = Object.fromEntries(
    readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );

  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const hoy = new Date().toISOString().slice(0, 10);
  const desdeHoy = new Date(`${hoy}T00:00:00`).toISOString();

  const [deHoy, colgados, movimientos] = await Promise.all([
    db.from('shipments').select('*, driver:assigned_driver(full_name)').eq('scheduled_date', hoy),
    db
      .from('shipments')
      .select('*, driver:assigned_driver(full_name)')
      .eq('status', 'pendiente_entrega')
      .is('reprogramado_en', null)
      .limit(50),
    db
      .from('delivery_logs')
      .select('shipment_id, event, happened_at')
      .gte('happened_at', desdeHoy)
      .order('happened_at', { ascending: true })
      .limit(1000),
  ]);

  for (const [que, r] of [
    ['envíos de hoy', deHoy],
    ['no entregados sin reprogramar', colgados],
    ['movimientos de hoy', movimientos],
  ] as const) {
    if (r.error) {
      console.log(`FALLA  ${que}: ${r.error.message}`);
      fallas++;
    } else {
      console.log(`  ok   ${que}: ${r.data?.length ?? 0}`);
    }
  }

  const enCaminoDesde = new Map<number, number>();
  for (const m of (movimientos.data ?? []) as { shipment_id: number; event: string; happened_at: string }[]) {
    if (m.event === 'en_camino') enCaminoDesde.set(m.shipment_id, Date.parse(m.happened_at));
  }

  const envios = [
    ...((deHoy.data ?? []) as unknown as Shipment[]),
    ...((colgados.data ?? []) as unknown as Shipment[]),
  ];

  const avisos = buscarAtrasos({ envios, enCaminoDesde, hoy });

  console.log(`\nEl panel mostraría ahora ${avisos.length} aviso(s):\n`);
  for (const a of avisos) {
    console.log(`  [${a.tono}] ${a.titulo}`);
    console.log(`      ${a.detalle}`);
    console.log(`      ${a.desde}`);
    console.log(`      botón "${a.accion}" → ${a.href}\n`);
  }

  // Contracuenta a mano, sin pasar por la función: si los dos números no dan
  // igual, la regla está mirando otra cosa que la que uno cree.
  const abiertos = (deHoy.data ?? []).filter(
    (s: { status: string }) => s.status !== 'entregado' && s.status !== 'cancelado',
  );
  console.log(
    `Contracuenta: de ${deHoy.data?.length ?? 0} envíos de hoy, ${abiertos.length} abiertos, ` +
      `${abiertos.filter((s: { assigned_driver: string | null }) => !s.assigned_driver).length} sin repartidor.`,
  );
}

contraLaBase()
  .catch((e) => {
    console.log(`FALLA  no se pudo consultar: ${e.message}`);
    fallas++;
  })
  .finally(() => {
    console.log(fallas ? `\n${fallas} falla(s).\n` : '\nTodo bien.\n');
    process.exit(fallas ? 1 : 0);
  });
