/**
 * Prueba el Panel del día: las cuatro reglas de atraso y la respuesta escrita.
 *
 *   npm run panel
 *
 * Dos partes. Primero casos armados a mano, donde se sabe qué tiene que dar:
 * es la única forma de probar "a las 15 hs todavía sin retirar" sin esperar a
 * las tres de la tarde. Después, contra la base de verdad, para ver qué
 * mostraría el panel hoy — que un aviso salte cuando no corresponde se nota
 * enseguida, pero uno que NO salta no deja rastro en ningún lado.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buscarAtrasos, limiteDeLaFranja } from '../lib/admin/atrasos';
import { horarioDeRetiro, tramosDeHorario } from '../lib/franja';
import { fueCorregido, logCash, summarizeLogs, type DeliveryLog } from '../lib/settlement';
import { armarBilletera } from '../lib/billetera';
import { respuestaParaElCliente } from '../lib/admin/respuesta';
import { colaDelTelefono, esTelefono, palabrasUtiles } from '../lib/admin/busqueda';
import { errorText } from '../lib/driver/errors';
import {
  nombreDelDestinatario,
  NOMBRE_EN_EL_PAQUETE,
  NOMBRE_FLEX,
  type Shipment,
} from '../lib/format';

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

/** Para lo que da un número y no una lista: cuántos tramos, qué hora. */
function casoNumero(nombre: string, obtenido: number, esperado: number) {
  caso(nombre, [String(obtenido)], [String(esperado)]);
}

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

/**
 * Una hora de Mar del Plata, como Date.
 *
 * El +3 la lleva a UTC, que es como se guarda. Acepta medias horas —11.5 son
 * las 11:30— porque las reglas que miran "cuánto falta" no se pueden probar
 * sólo en horas enteras: el límite de una hora justo cae en el medio.
 */
function enHora(hora: number): Date {
  const h = Math.floor(hora) + 3;
  const min = Math.round((hora - Math.floor(hora)) * 60);
  return new Date(
    `${HOY}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00Z`,
  );
}

function tipos(envios: Shipment[], hora: number, enCamino: [number, number][] = []) {
  const ahora = enHora(hora);
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

/*
 * PREASIGNADO YA TIENE DUEÑO.
 *
 * El 19/08/2026 el panel avisaba "1 envío de hoy sin repartidor" de uno que
 * estaba preasignado a Agustín, con su colecta mandada y el aviso ya en el
 * celular. El aviso pedía hacer algo que estaba hecho.
 *
 * Los dos casos van juntos porque el arreglo se puede hacer mal: si sólo se
 * corrige la regla de "sin asignar", el preasignado deja de salir ahí y no
 * empieza a salir en la de "sigue en el comercio" —que miraba `assigned_driver`
 * igual que la otra— y el envío se cae por el medio sin que nadie avise.
 */
caso(
  'preasignado a las 10: ya tiene dueño, no es "sin asignar"',
  tipos([envio({ preasignado_a: 'd1', created_at: `${HOY}T09:40:00` })], 10),
  [],
);

caso(
  'preasignado y sin retirar a las 16: avisa igual que un asignado',
  tipos([envio({ preasignado_a: 'd1', created_at: `${HOY}T09:40:00` })], 16),
  ['sin_retirar'],
);

caso(
  'sin nadie atrás sigue saliendo como sin asignar',
  tipos([envio({ created_at: `${HOY}T09:40:00` })], 10),
  ['sin_asignar'],
);

caso(
  'asignado y sin retirar a las 16: pasó el corte',
  tipos([envio({ assigned_driver: 'd1', created_at: `${HOY}T15:40:00` })], 16),
  ['sin_retirar'],
);

// Antes esto avisaba: la regla contaba las horas desde que se cargó. Ahora no,
// y es a propósito — sin franja escrita, lo que manda es el corte de las 15.
caso(
  'cargado tempranísimo pero sin franja: a las 11 todavía no molesta',
  tipos([envio({ assigned_driver: 'd1', created_at: `${HOY}T06:00:00` })], 11),
  [],
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
    16,
  ),
  ['sin_reprogramar', 'sin_retirar'],
);


// ------------------------------------------------ franjas horarias de verdad

console.log('\n=== lo que dice cada franja (sacadas de la base) ===\n');

for (const [texto, esperado] of [
  ['antes de 19 hs', 19],
  ['ANTES 13HS', 13],
  ['antes de 18 hs', 18],
  ['11 a 12:30 hs', 12.5],
  ['14 A 17HS', 17],
  ['9 a 15 hs', 15],
  ['10 a 12 hs', 12],
  ['15 a 17 hs', 17],
  ['por la mañana', null],
  ['', null],
] as const) {
  caso(
    `"${texto || '(vacío)'}" cierra ${esperado ?? 'sin hora'}`,
    [String(limiteDeLaFranja(texto))],
    [String(esperado)],
  );
}

// ------------------------------------- el caso que reporto Matias el 15/08

console.log('\n=== el envio cargado ayer para hoy ===\n');

const cargadoAyer = envio({
  id: 91,
  tracking_code: 'EDR00001091MDQ',
  assigned_driver: 'd1',
  status: 'creado',
  created_at: '2026-08-13T16:54:00Z', // 13:54 del dia ANTERIOR
  scheduled_date: HOY,
  delivery_window: 'antes de 19 hs',
});

caso('a las 9 de la mañana no molesta', tipos([cargadoAyer], 9), []);
caso('a las 13 tampoco: la franja cierra recien a las 19', tipos([cargadoAyer], 13), []);
caso('a las 17 sí: quedan dos horas', tipos([cargadoAyer], 17), ['sin_retirar']);

const franjaTemprana = envio({ ...cargadoAyer, delivery_window: '11 a 12:30 hs' });
caso('con franja de 11 a 12:30, a las 9 todavia no', tipos([franjaTemprana], 9), []);
caso('con franja de 11 a 12:30, a las 11 sí', tipos([franjaTemprana], 11), ['sin_retirar']);

const sinFranja = envio({ ...cargadoAyer, delivery_window: null });
caso('sin franja, a las 13 no', tipos([sinFranja], 13), []);
caso('sin franja, a las 15 sí (el corte de siempre)', tipos([sinFranja], 15), ['sin_retirar']);

caso(
  'ya retirado, no importa la hora',
  tipos([envio({ ...cargadoAyer, status: 'retirado' })], 18),
  [],
);

// Con la franja ya vencida el aviso cambia de color: deja de ser "apurate" y
// pasa a ser "el compromiso ya se incumplió".
function tono(envios: Shipment[], hora: number) {
  const ahora = enHora(hora);
  return buscarAtrasos({ envios, enCaminoDesde: new Map(), ahora, hoy: HOY }).map((a) => a.tono);
}

const franja10a12 = envio({ ...cargadoAyer, delivery_window: '10 a 12 hs' });
caso('a las 9, con franja 10 a 12, todavía nada', tipos([franja10a12], 9), []);
caso('a las 11 avisa en naranja', tono([franja10a12], 11), ['naranja']);
caso('a las 15, con la franja vencida, avisa en rojo', tono([franja10a12], 15), ['rojo']);

/*
 * MENOS DE UNA HORA ES ALERTA, y la cuenta es estricta.
 *
 * A las 11 en punto faltan sesenta minutos justos y todavía es naranja: el
 * repartidor recién está saliendo y llega tranquilo. A las 11:30 ya no, y ahí
 * pasa a rojo sin esperar a que la franja se venza — avisar cuando el
 * compromiso ya se incumplió es avisar tarde.
 */
caso('a las 11:30, con franja hasta las 12, ya es rojo', tono([franja10a12], 11.5), ['rojo']);

/*
 * Y EL QUE YA LO TIENE ENCIMA TAMBIÉN AVISA.
 *
 * Antes, un envío retirado no decía nada hasta que pasaba hora y media en
 * camino. Pero uno retirado a las 11 con franja hasta las 13 es urgente a las
 * 12:20, no a las 14: que esté en la moto no es que esté entregado.
 */
const enLaMoto = envio({ ...cargadoAyer, status: 'retirado', delivery_window: 'antes de 19 hs' });
caso('retirado, a las 18 en punto todavía no', tipos([enLaMoto], 18), []);
caso('retirado, a las 18:30 sí', tipos([enLaMoto], 18.5), ['demorado']);
caso('retirado, a las 18:30 avisa en rojo', tono([enLaMoto], 18.5), ['rojo']);

/*
 * ------------------------------------------- el comercio está por cerrar
 *
 * Es una restricción distinta de la franja de entrega, y por eso se prueba
 * aparte: un paquete con entrega "antes de 19" que se retira en un local que
 * cierra a las 18 hay que ir a buscarlo antes de las 18, no antes de las 19.
 *
 * El horario sale del comercio, o del envío cuando trae el suyo (paso 48).
 */
type ConComercio = Shipment & { comercio?: { pickup_window?: string | null } | null };

const enLocal = (extra: Partial<ConComercio>): Shipment =>
  ({
    ...envio({ ...cargadoAyer, status: 'pendiente_retiro', delivery_window: 'antes de 19 hs' }),
    ...extra,
  }) as Shipment;

const cierra18 = enLocal({ comercio: { pickup_window: '9 a 18 hs' } });

/*
 * Sin horario de retiro cargado, esta regla no aporta nada: a las 16:30 no hay
 * ningún aviso, y a las 17:30 hay UNO SOLO, el de la franja de entrega, que ya
 * existía. Es la comprobación de que agregar la regla del comercio no ensució
 * lo que ya andaba.
 */
caso('sin horario cargado, a las 16:30 no avisa nada', tipos([enLocal({})], 16.5), []);
caso('sin horario cargado, a las 17:30 avisa sólo por la entrega',
  tipos([enLocal({})], 17.5), ['sin_retirar']);

/*
 * Y con el local cerrando, UN SOLO aviso y no dos.
 *
 * Las dos reglas hablan del mismo paquete a la misma hora —hay que entregarlo
 * antes de las 19 y se retira donde cierran a las 18— y mostrarlo dos veces con
 * dos motivos distintos hace dudar de cuál mirar. Gana el del comercio, que
 * tiene la hora dura: pasada la persiana no hay nada que hacer hasta mañana.
 * Se nota en el color: la regla de la entrega a esa hora sería naranja.
 */
caso('a las 16:30, con el local abierto hasta 18, todavía no', tipos([cierra18], 16.5), []);
caso('a las 17:30 avisa que el comercio cierra', tipos([cierra18], 17.5), ['sin_retirar']);
caso('y avisa en rojo', tono([cierra18], 17.5), ['rojo']);

// El del envío le gana al del comercio: "este retiralo antes de las 12".
const excepcion = enLocal({
  comercio: { pickup_window: '9 a 18 hs' },
  pickup_window: 'antes de las 12',
});
caso('con horario propio, avisa a las 11:30 aunque el local cierre a las 18',
  tipos([excepcion], 11.5), ['sin_retirar']);
caso('y a las 10 todavía no', tipos([excepcion], 10), []);

// Cinco paquetes en el mismo local son UN aviso, no cinco.
const otroIgual = enLocal({ comercio: { pickup_window: '9 a 18 hs' } });
caso('varios paquetes del mismo comercio dan un solo aviso',
  tipos([cierra18, otroIgual], 17.5), ['sin_retirar']);

/*
 * ------------------------------------------ comercios que cierran al mediodía
 *
 * Ama y Pola abre "9 a 13 hs y 15:30 a 18 hs", y eso rompía la primera
 * versión: tomaba la última hora del texto —las 18— y se perdía la siesta
 * entera. El repartidor llegaba a las 13:30 a una persiana baja, y el aviso de
 * "está por cerrar" no saltaba a las 12:30, que es justo cuando había que
 * salir.
 *
 * La siesta NO avisa: el paquete sale igual a la tarde, y un aviso todos los
 * días a las dos se aprende a ignorar justo antes del que importa.
 */
const amaYPola = enLocal({ comercio: { pickup_window: '9 a 13 hs y 15:30 a 18 hs' } });

caso('a las 11 no avisa: cierra recién a las 13', tipos([amaYPola], 11), []);
caso('a las 12:30 avisa: cierra por la siesta en media hora',
  tipos([amaYPola], 12.5), ['sin_retirar']);
caso('a las 14, en plena siesta, NO avisa: vuelve a abrir a las 15:30',
  tipos([amaYPola], 14), []);
caso('a las 16 tampoco: abrió de nuevo y cierra recién a las 18',
  tipos([amaYPola], 16), []);
caso('a las 17:30 avisa: ahora sí cierra por hoy', tipos([amaYPola], 17.5), ['sin_retirar']);

/* Y el partido se entiende igual con otras formas de escribirlo. */
casoNumero('escrito con guiones', tramosDeHorario('9-13 / 15:30-18').length, 2);
casoNumero('escrito de corrido', tramosDeHorario('9 a 13 y 15:30 a 18').length, 2);
casoNumero('uno solo sigue siendo uno', tramosDeHorario('9 a 18 hs').length, 1);
casoNumero('"hasta las 13" es un cierre sin apertura', tramosDeHorario('hasta las 13')[0].hasta, 13);
casoNumero('al revés se descarta', tramosDeHorario('18 a 9').length, 0);

/*
 * ------------------------------------------------- lo que se le paga al cadete
 *
 * Esto es plata y por eso se prueba. Dos tarifas que no se mezclan:
 *
 *   · envío normal → el 70%, porque el 30% es la comisión de la empresa;
 *   · envío de Shippy → ENTERO, sin comisión. A la empresa Shippy le paga
 *     aparte y ahí está la ganancia; descontarle el 30% al repartidor sería
 *     cobrarle una comisión que ya está cobrada del otro lado.
 *
 * El cierre de caja y los resúmenes usan las MISMAS reglas: hasta hoy el cierre
 * pedía el número a mano y podían decir cosas distintas de la misma plata.
 */
function entrega(comercio: string, envio: number, cobrado = 0): DeliveryLog {
  return {
    id: `l${comercio}${envio}${cobrado}`,
    event: 'entregado',
    amount_collected: cobrado,
    happened_at: `${HOY}T15:00:00Z`,
    failure_reason: null,
    shipment: {
      id: Math.round(Math.random() * 1e9),
      tracking_code: 'EDR00000000MDQ',
      recipient_name: 'Quien sea',
      address_street: 'Falucho 1832',
      amount_to_collect: cobrado,
      payment_mode: 'cobrar_destinatario',
      shipping_fee: envio,
      client_name_raw: comercio,
    },
  };
}

const pago = (logs: DeliveryLog[]) => summarizeLogs(logs).driverEarnings;

casoNumero('un envío normal de $10.000 paga $7.000', pago([entrega('TOY PIOLA', 10000)]), 7000);
casoNumero('dos normales suman el 70% de los dos',
  pago([entrega('TOY PIOLA', 10000), entrega('WELIVERY', 5000)]), 10500);

casoNumero('uno de KILLARI de $3.000 paga los $3.000 enteros',
  pago([entrega('KILLARI', 3000)]), 3000);
casoNumero('uno de SHOPIGO sin valor cargado paga los $3.000 de la regla',
  pago([entrega('SHOPIGO', 0)]), 3000);

casoNumero('mezclados: $10.000 normal + Shippy = 7.000 + 3.000',
  pago([entrega('TOY PIOLA', 10000), entrega('KILLARI', 3000)]), 10000);

/* El saldo: lo que cobró, menos lo rendido, menos lo que le toca. */
const dia = summarizeLogs([entrega('TOY PIOLA', 10000, 50000), entrega('KILLARI', 3000)]);
casoNumero('cobró 50.000 y le tocan 10.000: rinde 40.000',
  dia.cashTotal - 0 - dia.driverEarnings, 40000);

// ----------------------------------------------- cómo se entiende la búsqueda

console.log('\n=== lo que se pega en el buscador ===\n');

for (const [texto, esperadas] of [
  ['BROWN 2055, Mar del Plata', ['brown', '2055']],
  ['Brown (fondo) 2055', ['brown', 'fondo', '2055']],
  ['DIAGONAL PUEYRREDÓN 2956, Mar del Plata', ['diagonal', 'pueyrredón', '2956']],
  ['Av. Independencia 1500', ['independencia', '1500']],
  ['calle 12 de Octubre 3400', ['12', 'octubre', '3400']],
] as const) {
  caso(`palabras de "${texto}"`, palabrasUtiles(texto), [...esperadas]);
}

for (const [texto, esperado] of [
  ['+54 223 513-5312', true],
  ['2235135312', true],
  ['223 555 1234', true],
  ['Alberti 2235', false],
  ['BROWN 2055', false],
] as const) {
  caso(
    `"${texto}" ${esperado ? 'es' : 'no es'} un teléfono`,
    [String(esTelefono(texto))],
    [String(esperado)],
  );
}

caso('del teléfono se usa la cola', [colaDelTelefono('+54 9 223 513-5312')], ['35135312']);

// --------------------------------------------- lo que lee el repartidor cuando
//                                                el servidor le dice que no

console.log('\n=== los rechazos que ve el repartidor ===\n');

/*
 * Casi todos los códigos se traducen a una frase fija y el detalle se descarta.
 * PREASIGNADO_A_OTRO es la excepción: el nombre de quién es el paquete VIENE en
 * el detalle, y sin él queda un "no podés" que no le dice al repartidor qué
 * hacer con lo que tiene en la mano. Se prueba porque ahora hay que partir
 * texto, y eso se rompe callado.
 */
caso(
  'el rechazo por preasignado dice de quién es',
  [errorText('PREASIGNADO_A_OTRO: Agustin Medina')],
  ['Ese paquete no es tuyo: quedó reservado para Agustin Medina.'],
);

caso(
  'y sin nombre no inventa nada',
  [errorText('PREASIGNADO_A_OTRO')],
  ['Ese paquete no es tuyo: quedó reservado para'],
);

caso(
  'los demás códigos siguen ignorando el detalle',
  [errorText('ENVIO_CERRADO: cualquier cosa')],
  ['Ese envío ya está cerrado: no lo lleves.'],
);

caso(
  'un mensaje que no es un código se muestra tal cual',
  [errorText('se cayó la conexión')],
  ['se cayó la conexión'],
);

// ------------------------------------------------- la respuesta que se copia

console.log('\n=== la respuesta que se le manda al cliente ===\n');

/*
 * Lo que se prueba acá no es el texto sino los dos límites que no se pueden
 * cruzar: que no salga plata ni datos del destinatario —esto se reenvía a un
 * chat que no controlamos— y que el tiempo vaya siempre como aproximado.
 */
const conPlata = envio({
  status: 'en_camino',
  payment_mode: 'cobrar_destinatario',
  amount_to_collect: 148200,
  merchandise_amount: 140000,
  shipping_fee: 8200,
  recipient_phone: '2235551234',
  recipient_name: 'Marcela Gómez',
});

const eta = { metros: 2400, desde: 10, hasta: 15, texto: 'Entre 10 y 15 minutos' };

for (const [nombre, datos] of [
  ['en camino', { envio: conPlata, eta, cierre: null }],
  ['en camino sin poder calcular', { envio: conPlata, eta: null, cierre: null }],
  ['todavía en el comercio', { envio: envio({ status: 'pendiente_retiro' }), eta: null, cierre: null }],
  [
    'entregado',
    {
      envio: envio({ status: 'entregado' }),
      eta: null,
      cierre: { event: 'entregado', happened_at: `${HOY}T16:42:00`, failure_reason: null },
    },
  ],
  [
    'no entregado',
    {
      envio: envio({ status: 'pendiente_entrega' }),
      eta: null,
      cierre: { event: 'no_entregado', happened_at: `${HOY}T12:40:00`, failure_reason: 'ausente' },
    },
  ],
  ['cancelado', { envio: envio({ status: 'cancelado' }), eta: null, cierre: null }],
] as const) {
  const texto = respuestaParaElCliente(datos);
  const filtra: string[] = [];

  for (const prohibido of ['148200', '148.200', '140000', '8200', '2235551234', '$']) {
    if (texto.includes(prohibido)) filtra.push(`dice "${prohibido}"`);
  }
  if (datos.eta && !texto.toLowerCase().includes('aproximadamente')) {
    filtra.push('promete una hora sin decir "aproximadamente"');
  }

  if (filtra.length) {
    fallas++;
    console.log(`FALLA  ${nombre}: ${filtra.join('; ')}`);
  } else {
    console.log(`  ok   ${nombre}`);
  }
  console.log(
    texto
      .split('\n')
      .map((l) => `         │ ${l}`)
      .join('\n'),
  );
}

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
    db.from('shipments').select('*, driver:assigned_driver(full_name), preasignado:preasignado_a(full_name)').eq('scheduled_date', hoy),
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
  // La cuenta mira las DOS columnas, igual que la regla. Contando sólo
  // `assigned_driver` la contracuenta decía "1 sin repartidor" de un envío
  // preasignado, justo lo contrario de lo que el panel muestra arriba.
  const conDueno = (s: { assigned_driver: string | null; preasignado_a?: string | null }) =>
    Boolean(s.assigned_driver || s.preasignado_a);

  console.log(
    `Contracuenta: de ${deHoy.data?.length ?? 0} envíos de hoy, ${abiertos.length} abiertos, ` +
      `${abiertos.filter((s: { assigned_driver: string | null }) => !conDueno(s)).length} sin nadie atrás ` +
      `(${abiertos.filter((s: { assigned_driver: string | null; preasignado_a?: string | null }) => !s.assigned_driver && s.preasignado_a).length} preasignados).`,
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

/* ==========================================================================
   EL HORARIO DE LOS SÁBADOS (paso 52)

   Un local que de lunes a viernes cierra a las 18 y el sábado a las 13 hacía
   saltar el aviso a las 17, con el comercio cerrado desde hacía cuatro horas.
   Lo que sigue fija las tres reglas: manda el del envío, después el del
   sábado, después el de siempre.
   ========================================================================== */

console.log('\n=== el horario de los sabados ===\n');

{
  const comercio = { pickup_window: '9 a 18 hs', pickup_window_sabado: '9 a 13 hs' };

  // Mediodía del sábado 22/08/2026 en Mar del Plata. Se escribe en UTC porque
  // es lo único que no cambia según dónde corra esto.
  const sabado = new Date('2026-08-22T15:00:00Z');
  const martes = new Date('2026-08-18T15:00:00Z');
  // Las 23 del viernes: en el servidor ya son las 02 del sábado, y ahí estaba
  // la trampa — el horario del sábado empezaría a regir seis horas antes.
  const viernesALaNoche = new Date('2026-08-22T02:00:00Z');

  caso('un martes manda el horario de siempre',
    [horarioDeRetiro({ comercio }, martes) ?? ''], ['9 a 18 hs']);
  caso('un sabado manda el del sabado',
    [horarioDeRetiro({ comercio }, sabado) ?? ''], ['9 a 13 hs']);
  caso('el viernes a las 23 todavia no es sabado',
    [horarioDeRetiro({ comercio }, viernesALaNoche) ?? ''], ['9 a 18 hs']);
  caso('sin sabado cargado, vale el de siempre',
    [horarioDeRetiro({ comercio: { pickup_window: '9 a 18 hs' } }, sabado) ?? ''], ['9 a 18 hs']);
  caso('el horario del ENVIO gana tambien un sabado',
    [horarioDeRetiro({ pickup_window: 'antes de 11', comercio }, sabado) ?? ''], ['antes de 11']);
  caso('"cerrado" no deja ninguna hora, asi que no hay cierre que avisar',
    [String(limiteDeLaFranja(horarioDeRetiro({ comercio: { pickup_window: '9 a 18 hs', pickup_window_sabado: 'cerrado' } }, sabado)))],
    ['null']);
}

/* ==========================================================================
   EL NOMBRE DEL DESTINATARIO

   Muchos envíos llegan sin nombre: el dato está escrito en el sobre. Lo que
   NO puede pasar es que alguien lea "Sin nombre" en la etiqueta, en el
   comprobante o en el seguimiento — se lee como un error del sistema justo
   cuando hay alguien esperando un paquete.

   Se prueba acá y no en la pantalla porque son quince pantallas: si la regla
   vive en un solo lugar, alcanza con probar ese lugar.
   ========================================================================== */

console.log('\n=== el nombre del destinatario ===\n');

{
  const quien = (recipient_name: string, is_flex = false) =>
    nombreDelDestinatario({ recipient_name, is_flex });

  caso('con nombre, va el nombre', [quien('Josefina Remon')], ['Josefina Remon']);
  caso('en un flex CON nombre, tambien va el nombre',
    [quien('Josefina Remon', true)], ['Josefina Remon']);

  caso('sin nombre, lo dice el sobre', [quien('')], [NOMBRE_EN_EL_PAQUETE]);
  caso('un flex sin nombre manda a su app', [quien('', true)], [NOMBRE_FLEX]);

  // Los rellenos que quedaron guardados en la base de antes. Son 40 de 71
  // envíos al 20/08/2026: si no se limpiaran al mostrarlos, seguirían saliendo
  // impresos aunque el parser ya no los escriba.
  caso('"Sin nombre" guardado no se muestra', [quien('Sin nombre')], [NOMBRE_EN_EL_PAQUETE]);
  caso('tampoco con mayusculas raras', [quien('SIN NOMBRE')], [NOMBRE_EN_EL_PAQUETE]);
  caso('ni "sin datos"', [quien('sin datos')], [NOMBRE_EN_EL_PAQUETE]);
  caso('ni "s/n"', [quien(' s/n ')], [NOMBRE_EN_EL_PAQUETE]);
  caso('ni un guion solo', [quien('-')], [NOMBRE_EN_EL_PAQUETE]);
  caso('un flex con "Sin nombre" guardado manda a su app',
    [quien('Sin nombre', true)], [NOMBRE_FLEX]);

  // Y el cartel guardado por error tampoco se repite ni se anida.
  caso('el propio cartel guardado no se muestra como nombre',
    [quien('Lo dice el sobre/papel')], [NOMBRE_EN_EL_PAQUETE]);

  /*
   * Las frases escritas a mano. Cada una la tecleó alguien un día distinto y
   * todas quieren decir lo mismo; el 20/08/2026 había envíos cargados con "Lo
   * dice el paquete", que hasta entonces se mostraba tal cual y encima
   * distinto del resto.
   */
  caso('"Lo dice el paquete"', [quien('Lo dice el paquete')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"lo dice el sobre"', [quien('lo dice el sobre')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"Dice el papel"', [quien('Dice el papel')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"esta en el sobre"', [quien('esta en el sobre')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"Está en la caja"', [quien('Está en la caja')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"va en la bolsa"', [quien('va en la bolsa')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"n/a"', [quien('n/a')], [NOMBRE_EN_EL_PAQUETE]);
  caso('"sin nada"', [quien('sin nada')], [NOMBRE_EN_EL_PAQUETE]);

  // Y lo que SÍ es un nombre sigue siéndolo, aunque tenga alguna de esas
  // palabras adentro.
  caso('"Sobrero" es un apellido', [quien('Sobrero')], ['Sobrero']);
  caso('"Paula Dice" es un nombre', [quien('Paula Dice')], ['Paula Dice']);
  caso('"Kiosco El Paquete" es un local', [quien('Kiosco El Paquete')], ['Kiosco El Paquete']);

  // Un nombre que EMPIEZA parecido sí es un nombre.
  caso('"Sin Nombre Apellido" es un nombre de verdad',
    [quien('Sin Nombre Apellido')], ['Sin Nombre Apellido']);
}

/* ==========================================================================
   CORREGIR LO QUE SE COBRO DE VERDAD (paso 54)

   El 20/08/2026 EDR00001147MDQ salio con $ 65.230 a cobrar y en la puerta se
   cobraron $ 36.900. El repartidor cerro con el monto que traia el envio, asi
   que la caja le pedia rendir $ 28.330 que nunca tuvo en la mano.

   Corregir el monto en la FICHA DEL ENVIO no arregla eso, y esta bien que no lo
   arregle: la caja cuenta lo que se cobro, no lo que se esperaba cobrar. Lo que
   manda es la correccion de la oficina.
   ========================================================================== */

console.log('\n=== corregir lo cobrado ===\n');

{
  const mov = (p: Partial<DeliveryLog> & { cobra?: number }): DeliveryLog => ({
    id: 'log-1',
    event: 'entregado',
    amount_collected: null,
    happened_at: '2026-08-20T06:33:04Z',
    failure_reason: null,
    shipment: {
      id: 1147,
      tracking_code: 'EDR00001147MDQ',
      recipient_name: 'María',
      address_street: 'ROLDAN 421',
      amount_to_collect: p.cobra ?? 0,
      payment_mode: 'cobrar_destinatario',
      shipping_fee: 3000,
      client_name_raw: 'KILLARI',
    },
    ...p,
  });

  casoNumero('sin correccion manda lo que cargo el repartidor',
    logCash(mov({ amount_collected: 65230, cobra: 36900 })), 65230);

  casoNumero('con correccion manda la correccion',
    logCash(mov({ amount_collected: 65230, cobra: 36900, cobrado_corregido: 36900 })), 36900);

  casoNumero('corregir a cero es valido: no cobro nada',
    logCash(mov({ amount_collected: 65230, cobrado_corregido: 0 })), 0);

  casoNumero('tambien corrige un retiro cobrado al comercio',
    logCash(mov({ event: 'retirado', amount_collected: 4600, cobrado_corregido: 4000 })), 4000);

  caso('la correccion se puede reconocer para mostrarla',
    [String(fueCorregido(mov({ amount_collected: 65230 }))),
     String(fueCorregido(mov({ amount_collected: 65230, cobrado_corregido: 36900 })))],
    ['false', 'true']);

  // Y el dia entero: lo que tiene que rendir sale corregido.
  const dia = summarizeLogs([
    mov({ id: 'a', amount_collected: 36900 }),
    mov({ id: 'b', amount_collected: 65230, cobrado_corregido: 36900 }),
  ]);
  casoNumero('el total a rendir del dia usa la correccion', dia.cashTotal, 73800);
}

/* ==========================================================================
   LA BILLETERA DEL REPARTIDOR (paso 55)

   Hasta el paso 55, lo rendido vivia adentro del cierre de UN DIA. Pero la
   plata no se entrega por dia: el repartidor junta lo de varias jornadas y un
   martes deja un monto que cubre todo. El 12/08/2026 quedo escrito "cobro
   $ 9.900, rindio $ 55.000" — cierto, pero pegado a un dia al que no pertenece.

   Acá el saldo sale de sumar todo, sin ventanas de tiempo.
   ========================================================================== */

console.log('\n=== la billetera ===\n');

{
  const entrega = (id: string, cobra: number, envio: number): DeliveryLog => ({
    id,
    event: 'entregado',
    amount_collected: cobra,
    happened_at: '2026-08-18T15:00:00Z',
    failure_reason: null,
    shipment: {
      id: 1,
      tracking_code: 'EDR1',
      recipient_name: 'X',
      address_street: 'CALLE 1',
      amount_to_collect: cobra,
      payment_mode: 'cobrar_destinatario',
      shipping_fee: envio,
      client_name_raw: 'STARCELL',
    },
  });

  const anotado = (id: number, tipo: 'rendicion' | 'pago' | 'ajuste', monto: number) => ({
    id,
    driver_id: 'moto',
    fecha: '2026-08-19',
    tipo,
    monto,
    nota: null,
    cargado_por: null,
    created_at: '2026-08-19T12:00:00Z',
  });

  // Un dia de trabajo, sin rendir nada todavia.
  const solo = armarBilletera('moto', [entrega('a', 10000, 4000), entrega('b', 5000, 4000)], []);
  casoNumero('cobro lo de los dos envios', solo.cobrado, 15000);
  casoNumero('debe rendir todo lo que cobro', solo.debeRendir, 15000);
  casoNumero('le tocan el 70% de los dos envios', solo.leDebemos, Math.round(8000 * 0.7));

  // Entrega una parte.
  const aMedias = armarBilletera('moto', [entrega('a', 10000, 4000)], [anotado(1, 'rendicion', 4000)]);
  casoNumero('rindiendo una parte, debe el resto', aMedias.debeRendir, 6000);

  // Entrega MAS de lo que cobro ese dia: es plata de dias anteriores, y el
  // saldo tiene que poder quedar en negativo en vez de trabarse en cero.
  const deMas = armarBilletera('moto', [entrega('a', 9900, 4000)], [anotado(1, 'rendicion', 55000)]);
  casoNumero('puede rendir mas de lo que cobro (plata vieja)', deMas.debeRendir, -45100);

  // Le pagamos lo suyo.
  const pagado = armarBilletera('moto', [entrega('a', 0, 10000)], [anotado(1, 'pago', 7000)]);
  casoNumero('pagandole todo, no se le debe nada', pagado.leDebemos, 0);

  // Las dos platas van separadas aunque el saldo las netee.
  const mixto = armarBilletera('moto', [entrega('a', 20000, 10000)], []);
  casoNumero('debe rendir lo cobrado', mixto.debeRendir, 20000);
  casoNumero('y por separado se le debe lo suyo', mixto.leDebemos, 7000);
  casoNumero('el saldo es la resta', mixto.saldo, 13000);

  // Un ajuste mueve el saldo y puede ir en negativo.
  const conAjuste = armarBilletera('moto', [entrega('a', 20000, 10000)], [anotado(1, 'ajuste', -3000)]);
  casoNumero('el ajuste negativo baja el saldo', conAjuste.saldo, 10000);

  // Un retiro cobrado al comercio suma a lo que debe, pero NO le paga a el.
  const retiro: DeliveryLog = { ...entrega('r', 0, 5300), event: 'retirado', amount_collected: 5300 };
  const conRetiro = armarBilletera('moto', [retiro], []);
  casoNumero('un retiro cobrado suma a lo que debe rendir', conRetiro.debeRendir, 5300);
  casoNumero('pero un retiro no le paga nada a el', conRetiro.leDebemos, 0);

  // Sin nada, todo en cero: la pantalla no puede mostrar un saldo inventado.
  const vacia = armarBilletera('moto', [], []);
  casoNumero('sin movimientos, no debe nada', vacia.debeRendir, 0);
  casoNumero('ni se le debe nada', vacia.leDebemos, 0);
}
