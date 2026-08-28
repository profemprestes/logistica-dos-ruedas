/**
 * La lectura de los archivos que mandan los comercios.
 *
 *   npm run archivo                      -> los casos de siempre
 *   npm run archivo -- "C:\ruta\al.pdf"  -> además, lee un PDF de verdad
 *
 * LOS CASOS NO USAN UN PDF, y no es por comodidad: la hoja de ruta de FLOW son
 * trece personas con su nombre, su teléfono y la puerta de su casa. Eso no
 * entra en el repositorio. Los renglones de acá abajo son los del archivo del
 * 28/08/2026 con las coordenadas REALES —medidas de ese PDF— y los datos
 * cambiados. La lógica que se prueba es la misma; lo que no queda es la gente.
 *
 * Para probar contra el archivo de verdad se le pasa la ruta por argumento y no
 * se guarda nada.
 */
import { armarTabla } from '@/lib/importar/tabla';
import type { Renglon } from '@/lib/importar/pdf';
import { FLOW_CONECTTA } from '@/lib/importar/plantillas';

const forma = {
  titulos: FLOW_CONECTTA.columnas.map((c) => c.titulo),
  ancla: FLOW_CONECTTA.ancla,
};

/** Un renglón: pares de [x, texto], como salen del PDF. */
const r = (y: number, celdas: [number, string][]): Renglon => ({
  pagina: 1,
  y,
  celdas: celdas.map(([x, texto]) => ({ x, texto })),
});

/*
 * Las X son las del PDF de FLOW, medidas con pdf.js. La de CANT (433) y la de
 * ACTIVIDAD (447) están a catorce puntos, y el valor de la cantidad arranca en
 * 441: a mitad de camino. Ese es el caso que rompe cualquier margen generoso.
 */
const ENCABEZADO = r(700, [
  [52, 'OT'], [89, 'CLIENTE'], [133, 'DIRECCIÓN'], [202, 'Piso'], [260, 'Puerta'],
  [317, 'Entre Calles'], [375, 'TELEFONOS'], [433, 'NT.'], [447, 'ACTIVIDAD'], [484, 'TURNO'],
]);

const MEMBRETE = [
  r(760, [[129, 'TL - HOJA DE RUTA'], [638, 'Repartidor:'], [714, 'Conectta']]),
  r(740, [[156, 'DIRECCIONES:'], [250, '13'], [651, 'Fecha:'], [710, '28/08/2026']]),
  r(720, [[433, 'CA']]),
];

interface Caso {
  titulo: string;
  renglones: Renglon[];
  filas: number;
  /** Qué fila mirar y qué tiene que decir cada columna. */
  espera: { fila: number; valores: Record<string, string> }[];
}

const CASOS: Caso[] = [
  {
    titulo: 'un envío repartido en cuatro renglones es UN envío',
    renglones: [
      ...MEMBRETE,
      ENCABEZADO,
      r(680, [[133, 'COLON ,AV. 1899,']]),
      r(668, [[133, 'GRAL PUEYRREDON,']]),
      r(656, [[89, 'Ana'], [133, 'BUENOS AIRES 7600'], [317, 'LAMADRID y'], [447, 'CONTROL']]),
      r(644, [[317, 'ARENALES'], [441, '1'], [447, 'FLOW']]),
      r(632, [[52, '05851722'], [89, 'Perez'], [133, 'Argentina'], [205, '12'], [262, 'A'], [383, '5492235000001']]),
    ],
    filas: 1,
    espera: [
      {
        fila: 0,
        valores: {
          CLIENTE: 'Ana Perez',
          'DIRECCIÓN': 'COLON ,AV. 1899, GRAL PUEYRREDON, BUENOS AIRES 7600 Argentina',
          Piso: '12',
          Puerta: 'A',
          TELEFONOS: '5492235000001',
          // El caso límite: el 1 es la cantidad, no parte del producto.
          'NT.': '1',
          ACTIVIDAD: 'CONTROL FLOW',
        },
      },
    ],
  },
  {
    titulo: 'dos envíos seguidos no se mezclan',
    renglones: [
      ...MEMBRETE,
      ENCABEZADO,
      r(680, [[133, 'VIAMONTE 2035,']]),
      r(668, [[89, 'Susana'], [133, 'BUENOS AIRES 7600'], [447, 'CONTROL']]),
      r(656, [[52, '05817345'], [89, 'Gomez'], [133, 'Argentina'], [205, '3'], [262, 'b'], [383, '5491140000002'], [441, '1'], [447, 'FLOW']]),
      r(632, [[133, 'MAGALLANES 5272,']]),
      r(620, [[89, 'Mabel'], [133, 'BUENOS AIRES 7600'], [317, 'GALICIA y AGOTE'], [447, 'CONTROL']]),
      r(608, [[52, '05839550'], [89, 'Marogna'], [133, 'Argentina'], [205, 'PB'], [262, '2'], [383, '5492235000003'], [441, '1'], [447, 'FLOW']]),
    ],
    filas: 2,
    espera: [
      { fila: 0, valores: { CLIENTE: 'Susana Gomez', Piso: '3', TELEFONOS: '5491140000002' } },
      { fila: 1, valores: { CLIENTE: 'Mabel Marogna', Piso: 'PB', Puerta: '2', TELEFONOS: '5492235000003' } },
    ],
  },
  {
    titulo: 'lo que queda a medio juntar al final NO inventa un envío',
    renglones: [
      ...MEMBRETE,
      ENCABEZADO,
      r(680, [[89, 'Juan'], [133, 'POSADAS 1071,']]),
      r(668, [[52, '05846802'], [89, 'Franco'], [133, 'Argentina'], [383, '5492236000004'], [441, '1'], [447, 'FLOW']]),
      // El pie del archivo: texto suelto, sin número de orden.
      r(560, [[133, 'Total de envíos: 1']]),
    ],
    filas: 1,
    espera: [{ fila: 0, valores: { CLIENTE: 'Juan Franco' } }],
  },
];

let fallos = 0;

for (const c of CASOS) {
  const malos: string[] = [];
  try {
    const tabla = armarTabla(c.renglones, forma);

    if (tabla.filas.length !== c.filas) {
      malos.push(`filas: esperaba ${c.filas} y dio ${tabla.filas.length}`);
    }
    for (const e of c.espera) {
      const fila = tabla.filas[e.fila];
      if (!fila) {
        malos.push(`no existe la fila ${e.fila}`);
        continue;
      }
      for (const [col, esperado] of Object.entries(e.valores)) {
        if ((fila[col] ?? '') !== esperado) {
          malos.push(`fila ${e.fila}, ${col}: esperaba "${esperado}" y vino "${fila[col] ?? ''}"`);
        }
      }
    }
    if (tabla.encabezado.Fecha !== '28/08/2026') {
      malos.push(`la fecha del encabezado vino "${tabla.encabezado.Fecha}"`);
    }
  } catch (e) {
    malos.push(`explotó: ${(e as Error).message}`);
  }

  if (malos.length) {
    fallos++;
    console.log(`✗ ${c.titulo}`);
    for (const m of malos) console.log(`    ${m}`);
  } else {
    console.log(`✓ ${c.titulo}`);
  }
}

/* Un formato que cambió: tiene que avisar, no devolver una tabla vacía. */
try {
  armarTabla([r(700, [[52, 'PEDIDO'], [89, 'NOMBRE']])], forma);
  console.log('✗ un archivo con otro formato tendría que avisar y no lo hizo');
  fallos++;
} catch {
  console.log('✓ un archivo con otro formato avisa en vez de dar una tabla vacía');
}

console.log(`\n${CASOS.length + 1 - fallos}/${CASOS.length + 1} casos bien`);

/* ----------------------------------------- contra un archivo de verdad */

const ruta = process.argv[2];

/* En un `await` suelto se cae: los scripts se compilan a CommonJS. */
async function contraElArchivoDeVerdad(ruta: string) {
  const { readFileSync } = await import('node:fs');
  const { enviosDeArchivo } = await import('@/lib/importar');

  const buf = readFileSync(ruta);
  const datos = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const { filas, fecha, leidas } = await enviosDeArchivo(datos, FLOW_CONECTTA, '2026-01-01');

  console.log(`\n--- ${ruta} ---`);
  console.log(`${leidas} filas | fecha del archivo: ${fecha || '(no trae)'}\n`);
  for (const f of filas) {
    console.log(
      [
        f.recipientName.padEnd(28).slice(0, 28),
        f.addressStreet.padEnd(26).slice(0, 26),
        f.addressExtra.padEnd(14),
        f.recipientPhone.padEnd(15),
        f.productDetail,
      ].join(' '),
      f.warnings.length ? `\n     ⚠ ${f.warnings.join(' // ')}` : '',
    );
  }
  console.log(`\nretiro: ${filas[0]?.pickupAddress} | comercio: ${filas[0]?.clientName}`);
}

if (ruta) void contraElArchivoDeVerdad(ruta);
