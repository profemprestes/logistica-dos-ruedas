/**
 * Un PDF convertido en renglones con posición.
 *
 * Los comercios grandes no mandan el pedido por WhatsApp: mandan la hoja de
 * ruta que les escupe su sistema. FLOW (CONECTTA) manda un PDF con una tabla
 * de trece envíos, y hasta ahora había que copiarlos a mano de a uno.
 *
 * UN PDF NO TIENE FILAS NI COLUMNAS. Adentro hay pedazos de texto, cada uno con
 * su coordenada, y nada que diga cuáles van juntos. La tabla se reconstruye:
 * los pedazos que están a la misma altura son un renglón, y la coordenada
 * horizontal dice a qué columna pertenece cada uno. Eso lo resuelve `tabla.ts`;
 * acá sólo se sacan los pedazos y se agrupan por altura.
 *
 * Sólo sirve para PDF generados por un sistema. Uno escaneado es una foto y no
 * tiene texto adentro: se avisa en vez de devolver una tabla vacía.
 */

/** Un pedazo de texto con su posición horizontal dentro del renglón. */
export interface Celda {
  x: number;
  texto: string;
}

export interface Renglon {
  pagina: number;
  y: number;
  celdas: Celda[];
}

/**
 * Dos pedazos separados por menos de esto en vertical son el mismo renglón.
 *
 * Es medio cuerpo de letra. Más chico parte en dos los renglones donde una
 * celda quedó un pelo más arriba —pasa en la columna CANT de FLOW, que viene
 * desalineada de la de al lado—; más grande junta dos renglones seguidos y
 * mezcla dos envíos en uno.
 */
const MISMO_RENGLON = 4;

/**
 * Dónde está el worker de pdf.js para el navegador.
 *
 * Es un archivo suelto que hay que servir, y lo deja ahí
 * `scripts/copiar-worker-pdf.mjs` antes de cada `dev` y cada `build`. Se lo
 * pide por su ruta en vez de dejar que lo empaquete el bundler porque esa
 * parte se rompe en cada actualización de Next, y cuando se rompe no falla al
 * compilar: falla el día que alguien sube un archivo.
 *
 * En Node —los scripts de prueba— no se toca: ahí pdf.js resuelve su worker
 * solo, y esta ruta no existe.
 */
const WORKER_EN_PUBLIC = '/pdf.worker.min.mjs';

/** Lee el PDF y devuelve sus renglones, de arriba hacia abajo y por página. */
export async function renglonesDePdf(datos: ArrayBuffer): Promise<Renglon[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined') pdfjs.GlobalWorkerOptions.workerSrc = WORKER_EN_PUBLIC;

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(datos),
    useWorkerFetch: false,
    useSystemFonts: true,
  }).promise;

  const pedazos: { pagina: number; x: number; y: number; texto: string }[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const pagina = await doc.getPage(p);
    const contenido = await pagina.getTextContent();

    for (const item of contenido.items) {
      if (!('str' in item)) continue;
      const texto = item.str.trim();
      if (!texto) continue;
      pedazos.push({ pagina: p, x: item.transform[4], y: item.transform[5], texto });
    }
  }

  if (!pedazos.length) {
    throw new Error(
      'El PDF no tiene texto adentro: debe ser un escaneo o una foto. ' +
        'Pedile al comercio el archivo original, o el Excel.',
    );
  }

  /*
   * Se ordena por página, después de arriba hacia abajo (la Y del PDF crece
   * hacia arriba, por eso va al revés) y después de izquierda a derecha. Con
   * ese orden alcanza con mirar el último renglón para saber si el pedazo que
   * sigue va ahí o empieza uno nuevo.
   */
  pedazos.sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x);

  const renglones: Renglon[] = [];
  for (const pedazo of pedazos) {
    const ultimo = renglones[renglones.length - 1];
    if (ultimo && ultimo.pagina === pedazo.pagina && Math.abs(ultimo.y - pedazo.y) < MISMO_RENGLON) {
      ultimo.celdas.push({ x: pedazo.x, texto: pedazo.texto });
    } else {
      renglones.push({
        pagina: pedazo.pagina,
        y: pedazo.y,
        celdas: [{ x: pedazo.x, texto: pedazo.texto }],
      });
    }
  }

  return renglones;
}
