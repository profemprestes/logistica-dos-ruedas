/**
 * Casos reales del parser de WhatsApp.
 *
 *   npm run parser
 *
 * Cada caso salió de un mensaje que un comercio mandó de verdad y que en algún
 * momento se leyó mal. Antes de tocar `lib/parseWhatsapp.ts`, correr esto; y
 * cuando aparezca un mensaje nuevo que se lea mal, agregarlo acá ANTES de
 * arreglarlo. Es el único lugar donde queda escrito por qué el parser hace las
 * cosas raras que hace.
 */
import { parseWhatsappText } from '@/lib/parseWhatsapp';

interface Caso {
  titulo: string;
  texto: string;
  /** Qué fila mirar. Por defecto la primera; hay casos donde el bug está abajo. */
  fila?: number;
  /** Cuántas filas tiene que dar en total. Sirve para cazar filas fantasma. */
  filas?: number;
  /**
   * Campos que se comparan EXACTOS y no por "contiene".
   *
   * Por defecto alcanza con que el texto esperado aparezca adentro, que es lo
   * que sirve para las notas. Pero para el nombre del destinatario eso deja
   * pasar el bug: si el parser devuelve "nad x1 Julia", esperar "Julia" da por
   * bueno justamente lo que está mal.
   */
  exactos?: string[];
  espera: Partial<
    Record<
      | 'addressStreet'
      | 'addressExtra'
      | 'pickupAddress'
      | 'recipientName'
      | 'recipientPhone'
      | 'deliveryWindow'
      | 'notes'
      | 'productDetail'
      | 'clientName',
      string
    >
  > & {
    paymentMode?: string;
    shippingFee?: number;
    merchandiseAmount?: number;
    amountToCollect?: number;
    isReminder?: boolean;
  };
}

/**
 * La tanda del 19/08/2026, tal cual la mandó Matías. Tres cosas mal en un solo
 * mensaje, y por eso está entera y no partida en pedacitos: los tres bugs
 * salían de cómo se leen las líneas UNA DESPUÉS DE OTRA, y separados no pasan.
 */
const TANDA_19_08 = `CATALINA INDUMENTARIA
RETIRA EN 1 MAYO 1632
- 10 A 12HS CARLOS ALVEAR 2355. COBRAR ENVIO $4600 (Stefania 2235464845)

DROPIX3D
RETIRA EN MORENO 3676
- ANTES 19HS CARLOS ALVEAR 3625. ENVIO $4000 (Josefina remon) (COBRAR AL RETIRAR) (FLEX)
- 14 A 19HS ARANA Y GOIRI 6760. ENVIO $5300 (Juan Carlos Ferreyro) (COBRAR AL RETIRAR) (FLEX)

EL CONDOR
RETIRA EN GUEMES 2945
- 11 A 12 30HS AV DORREGO 172 PLANTA YPF. ENVIO $5300 (NO COBRAR)`;

const CASOS: Caso[] = [
  {
    titulo: 'direccion simple con depto pegado',
    texto: 'STARCELL\nRETIRA EN COLON 2749\n- SAN JUAN 1773 1B. ENVIO $3000 (NO COBRAR)',
    espera: { addressStreet: 'SAN JUAN 1773', addressExtra: '1B', shippingFee: 3000, paymentMode: 'no_cobrar' },
  },
  {
    titulo: 'referencia sin altura',
    texto: 'EL CONDOR\nRETIRA EN GUEMES 2945\n- AV DORREGO 172 PLANTA YPF. ENVIO $5300 (NO COBRAR)',
    espera: { addressStreet: 'AV DORREGO 172', notes: 'PLANTA YPF' },
  },
  {
    titulo: 'calle con Y en el nombre (NO es esquina)',
    texto: 'DROPIX\nRETIRA EN COLON 2749\n- ARANA Y GOIRI 6008. ENVIO $5300 (NO COBRAR)',
    espera: { addressStreet: 'ARANA Y GOIRI 6008' },
  },
  {
    titulo: 'comercio en negrita y FLEX del comercio',
    texto: '*TOYPIOLA*\nRETIRA EN INDEPENDENCIA 2684 (FLEX)\n- ANTES 19HS CALABRIA 5543. ENVIO $5300 (NO COBRAR)',
    espera: { addressStreet: 'CALABRIA 5543', isReminder: true, deliveryWindow: 'antes de 19 hs' },
  },
  {
    titulo: 'cobrar envio',
    texto: 'DAIANA\nRETIRA EN DORREGO 2043\n- DORREGO 2043. COBRAR ENVIO $4600',
    espera: { paymentMode: 'cobrar_destinatario', shippingFee: 4600 },
  },
  {
    titulo: 'cobrar al destinatario',
    texto: 'KILLARI\nRETIRA EN COLON 2749\n- JUAN DE DIOS FILBERTO 661. COBRAR $39400. ENVIO $3000',
    espera: { paymentMode: 'cobrar_destinatario', amountToCollect: 39400, shippingFee: 3000 },
  },
  {
    titulo: 'esquina sin altura',
    texto: 'LA PERI\nRETIRA EN GALICIA 2166\n- CALLE 20 Y CALLE 491. ENVIO $7000 (NO COBRAR)',
    espera: { addressStreet: 'CALLE 20 y CALLE 491' },
  },
  {
    titulo: 'esquina con ESQ',
    texto: 'JUAN\nRETIRA EN COLON 2749\n- INDEPENDENCIA ESQ ALBERTI. ENVIO $5300 (NO COBRAR)',
    espera: { addressStreet: 'INDEPENDENCIA ESQ ALBERTI' },
  },
  {
    titulo: 'nota larga despues de la altura NO se pega como esquina',
    texto:
      'NORMA\nRETIRA EN LURO 5550\n- LURO 5550 Y RECETAS A NOMBRE DE NORMA VITTA DRA LEMMA DEJAR EN BUZON. ENVIO $3700 (NO COBRAR)',
    espera: { addressStreet: 'LURO 5550' },
  },
  {
    titulo: 'contacto con telefono pegado sin espacios',
    texto: 'WANDA\nRETIRA EN COLON 2749\n- LAS HERAS 2159 4B. ENVIO $4600 (Wanda 2236602699)',
    espera: { addressStreet: 'LAS HERAS 2159', addressExtra: '4B', recipientName: 'Wanda', recipientPhone: '2236602699' },
  },
  {
    titulo: 'retiro con depto doble',
    texto: 'STARCELL\nRETIRA EN BELGRANO 2875 5A/B\n- CHAMPAGNAT 1350. ENVIO $4000 (NO COBRAR)',
    espera: { pickupAddress: 'BELGRANO 2875 5A/B' },
  },
  {
    titulo: 'exportado de WhatsApp con fecha adelante',
    texto: '[12/8, 09:14] Matias: STARCELL\n[12/8, 09:14] Matias: - BOLIVAR 4167. ENVIO $4000 (NO COBRAR)',
    espera: { addressStreet: 'BOLIVAR 4167', shippingFee: 4000 },
  },
  {
    titulo: 'un comercio con numero adentro del nombre es un comercio',
    texto: TANDA_19_08,
    fila: 1,
    filas: 4,
    espera: { clientName: 'DROPIX3D', pickupAddress: 'MORENO 3676', addressStreet: 'CARLOS ALVEAR 3625' },
  },
  {
    titulo: 'y no se lleva puestos los envios que vienen abajo',
    texto: TANDA_19_08,
    fila: 2,
    espera: { clientName: 'DROPIX3D', addressStreet: 'ARANA Y GOIRI 6760', paymentMode: 'cobrar_al_retirar' },
  },
  {
    titulo: 'calle que empieza con numero: 1 MAYO 1632 no es "1"',
    texto: TANDA_19_08,
    fila: 0,
    espera: { clientName: 'CATALINA INDUMENTARIA', pickupAddress: '1 MAYO 1632' },
  },
  {
    titulo: 'COBRAR ENVIO: el envio ES lo que se cobra en la puerta',
    texto: TANDA_19_08,
    fila: 0,
    espera: {
      addressStreet: 'CARLOS ALVEAR 2355',
      paymentMode: 'cobrar_destinatario',
      shippingFee: 4600,
      merchandiseAmount: 0,
      amountToCollect: 4600,
    },
  },
  {
    titulo: 'COBRAR total con ENVIO aparte: se cobra el total, no el envio',
    texto: 'STARCELL\nRETIRA EN COLON 2749\n- SAN JUAN 1773. COBRAR $55930. ENVIO $3000',
    espera: {
      paymentMode: 'cobrar_destinatario',
      shippingFee: 3000,
      merchandiseAmount: 55930,
      amountToCollect: 55930,
    },
  },
  {
    titulo: 'parentesis sin telefono con nombre: es el destinatario',
    texto: TANDA_19_08,
    fila: 1,
    espera: { recipientName: 'Josefina remon', clientName: 'DROPIX3D' },
  },
  {
    titulo: 'y el de tres palabras tambien',
    texto: TANDA_19_08,
    fila: 2,
    espera: { recipientName: 'Juan Carlos Ferreyro' },
  },
  {
    titulo: 'una aclaracion corta NO es un nombre',
    texto:
      'STARCELL\nRETIRA EN COLON 2749\n- SAN JUAN 1773. ENVIO $4000 (NO COBRAR) (dejar en porteria)',
    espera: { notes: 'dejar en porteria' },
  },
  {
    titulo: 'planta baja tampoco',
    texto:
      'STARCELL\nRETIRA EN COLON 2749\n- SAN JUAN 1773. ENVIO $4000 (NO COBRAR) (planta baja)',
    espera: { notes: 'planta baja' },
  },
  {
    titulo: 'una nota larga sigue yendo a notas',
    texto:
      'STARCELL\nRETIRA EN COLON 2749\n- SAN JUAN 1773. ENVIO $4000 (NO COBRAR) (volver a rendir al terminar)',
    espera: { notes: 'volver a rendir al terminar' },
  },

  /*
   * EL CONDOR, 21/08/2026. Un retiro y DOS entregas escritas con una barra.
   * Daba una sola fila con "LIBERTAD 5140" y "/GUIDO 1178" tirado en las notas:
   * la segunda entrega no existía, así que nadie la iba a hacer.
   *
   * El parser ya sabía partir en dos por la barra, pero nunca le llegaba: el
   * detector de direcciones cortaba en la altura de la primera y la barra con
   * todo lo que seguía se iba al sobrante.
   */
  {
    titulo: 'dos entregas con barra: la primera',
    texto:
      '*EL CONDOR*\nRETIRA EN NEUQUEN 2200\n\n* ANTES 9HS LIBERTAD 5140/GUIDO 1178. ENVIO $5800 (NO COBRAR)',
    filas: 2,
    espera: { addressStreet: 'LIBERTAD 5140', pickupAddress: 'NEUQUEN 2200', shippingFee: 5800 },
  },
  {
    titulo: 'dos entregas con barra: la segunda, con el mismo retiro',
    texto:
      '*EL CONDOR*\nRETIRA EN NEUQUEN 2200\n\n* ANTES 9HS LIBERTAD 5140/GUIDO 1178. ENVIO $5800 (NO COBRAR)',
    fila: 1,
    filas: 2,
    // Va en cero: el comercio paga UN envío. Las dos quedan atadas al guardar.
    espera: { addressStreet: 'GUIDO 1178', pickupAddress: 'NEUQUEN 2200', shippingFee: 0 },
  },
  {
    titulo: 'el retiro puede ser una esquina',
    texto:
      '*EL CONDOR*\nRETIRA EN COLON Y NEUQUEN\n\n* ANTES 9HS LIBERTAD 5140/GUIDO 1178. ENVIO $5800 (NO COBRAR)',
    filas: 2,
    espera: { pickupAddress: 'COLON Y NEUQUEN' },
  },

  /*
   * KILLARI, 21/08/2026. Dos cosas en el mismo mensaje.
   *
   * En ROLDAN el monto no entraba: estaba escrito "COBRAR. $65230." y el
   * detector pedía que después de COBRAR viniera el "$" o dos puntos, nunca un
   * punto. El envío entró como "no cobrar" con $ 0, y el repartidor no se
   * enteraba de que tenía que cobrar sesenta y cinco mil pesos en la puerta.
   *
   * Y en las dos, el producto se leía como el nombre del destinatario:
   * "(nad x1, Julia 542233489609)" daba "nad x1 Julia".
   */
  {
    titulo: 'COBRAR con punto: BERUTTI',
    texto:
      'KILLARI\nRETIRA EN BASE\n- 15 A 19HS BERUTTI 8664. COBRAR $36900 (nad x1, Julia 542233489609)\n- 15 A 19HS ROLDAN 421. COBRAR. $65230. (Nad x2, María 542236787626)',
    filas: 2,
    exactos: ['recipientName', 'productDetail'],
    espera: {
      addressStreet: 'BERUTTI 8664',
      recipientName: 'Julia',
      recipientPhone: '542233489609',
      productDetail: 'nad x1',
      paymentMode: 'cobrar_destinatario',
      amountToCollect: 36900,
    },
  },
  {
    titulo: 'COBRAR con punto: ROLDAN, que era la que fallaba',
    texto:
      'KILLARI\nRETIRA EN BASE\n- 15 A 19HS BERUTTI 8664. COBRAR $36900 (nad x1, Julia 542233489609)\n- 15 A 19HS ROLDAN 421. COBRAR. $65230. (Nad x2, María 542236787626)',
    fila: 1,
    filas: 2,
    exactos: ['recipientName', 'productDetail'],
    espera: {
      addressStreet: 'ROLDAN 421',
      recipientName: 'María',
      recipientPhone: '542236787626',
      productDetail: 'Nad x2',
      paymentMode: 'cobrar_destinatario',
      amountToCollect: 65230,
    },
  },
  {
    titulo: 'un nombre solo en el parentesis sigue siendo el nombre',
    texto: 'KILLARI\nRETIRA EN BASE\n- ROLDAN 421. COBRAR $1000 (Julia 542233489609)',
    espera: { recipientName: 'Julia', recipientPhone: '542233489609', productDetail: '' },
  },
  {
    titulo: 'Flow: el segundo parentesis sin telefono es el producto',
    texto:
      'FLOW(CONECTTA)\nRETIRA EN BASE\n' +
      '- ANTES 19HS MISIONES 2273 (Antonio Louro, 2235762833) (Control flow)\n' +
      '- ANTES 19HS LAS HERAS 2862. (Pablo gorostegui 2235369280) (control Deco)',
    filas: 2,
    fila: 1,
    exactos: ['productDetail', 'recipientName'],
    espera: {
      addressStreet: 'LAS HERAS 2862',
      recipientName: 'Pablo gorostegui',
      recipientPhone: '2235369280',
      productDetail: 'control Deco',
      pickupAddress: 'BASE',
    },
  },
];

let fallos = 0;

for (const c of CASOS) {
  const filas = parseWhatsappText(c.texto);
  const r = filas[c.fila ?? 0];
  if (!r) {
    console.log(`✗ ${c.titulo}: NO PARSEO LA FILA ${c.fila ?? 0} (dio ${filas.length})`);
    fallos++;
    continue;
  }

  const malos: string[] = [];
  if (c.filas !== undefined && filas.length !== c.filas) {
    malos.push(`filas: esperaba ${c.filas} y dio ${filas.length}`);
  }
  for (const [campo, esperado] of Object.entries(c.espera)) {
    const real = (r as unknown as Record<string, unknown>)[campo];
    const ok =
      typeof esperado === 'string'
        ? c.exactos?.includes(campo)
          ? String(real ?? '') === esperado
          : String(real ?? '').toUpperCase().includes(esperado.toUpperCase())
        : real === esperado;
    if (!ok) malos.push(`${campo}: esperaba "${esperado}" y vino "${real}"`);
  }

  if (malos.length) {
    fallos++;
    console.log(`✗ ${c.titulo}`);
    for (const m of malos) console.log(`    ${m}`);
  } else {
    console.log(`✓ ${c.titulo}`);
  }
}

console.log(`\n${CASOS.length - fallos}/${CASOS.length} casos bien`);
