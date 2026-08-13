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
  espera: Partial<Record<'addressStreet' | 'addressExtra' | 'pickupAddress' | 'recipientName' | 'recipientPhone' | 'deliveryWindow' | 'notes', string>> & {
    paymentMode?: string;
    shippingFee?: number;
    amountToCollect?: number;
    isReminder?: boolean;
  };
}

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
];

let fallos = 0;

for (const c of CASOS) {
  const filas = parseWhatsappText(c.texto);
  const r = filas[0];
  if (!r) {
    console.log(`✗ ${c.titulo}: NO PARSEO NINGUNA FILA`);
    fallos++;
    continue;
  }

  const malos: string[] = [];
  for (const [campo, esperado] of Object.entries(c.espera)) {
    const real = (r as unknown as Record<string, unknown>)[campo];
    const ok =
      typeof esperado === 'string'
        ? String(real ?? '').toUpperCase().includes(esperado.toUpperCase())
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
