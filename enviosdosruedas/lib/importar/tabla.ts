import type { Renglon } from './pdf';

/**
 * Los renglones sueltos de un PDF, convertidos en filas de una tabla.
 *
 * LAS COLUMNAS SE APRENDEN DEL ENCABEZADO, no se escriben a mano en el código.
 * La plantilla dice cómo se llaman —"CLIENTE", "TELEFONOS"— y acá se busca el
 * renglón donde están esos títulos: la posición de cada uno es dónde empieza su
 * columna. Por eso, si FLOW mañana ensancha una columna o mete otra en el
 * medio, el archivo se sigue leyendo igual; y por eso dar de alta un comercio
 * nuevo es escribir los nombres de sus columnas y nada más.
 *
 * UNA FILA SON VARIOS RENGLONES. El nombre y la dirección no entran en una
 * línea, así que un envío ocupa tres o cuatro y sólo la última trae el número
 * de orden:
 *
 *     |          | VIAMONTE 2035, GRAL |   |   |               |
 *     | Susana   | BUENOS AIRES 7600   |   |   |               |
 *     | 05817345 | Argentina           | 3 | b | 5491140497123 |
 *
 * Las tres son el mismo envío. Por eso la plantilla nombra una COLUMNA ANCLA
 * —en FLOW, la del número de orden— que aparece una sola vez por envío y
 * cierra el bloque.
 */

/** Una fila ya armada: el valor de cada columna, junto y en orden de lectura. */
export type FilaDeTabla = Record<string, string>;

export interface FormaDeTabla {
  /** Los títulos tal cual están escritos en el archivo. */
  titulos: string[];
  /**
   * La columna que aparece UNA VEZ POR FILA y en su último renglón. Cuando
   * aparece, el bloque que se venía juntando es una fila y se cierra.
   */
  ancla: string;
}

/**
 * Cuánto puede empezar un valor a la izquierda del título de su columna.
 *
 * Chico a propósito. En la hoja de FLOW, CANT y ACTIVIDAD están pegadas —seis
 * puntos— y el "1" de la cantidad arranca a mitad de camino: con un margen
 * generoso se lo lleva ACTIVIDAD y el envío queda con producto "CONTROL 1 FLOW"
 * y sin cantidad. Nunca se estira más allá de la mitad de la distancia con la
 * columna anterior.
 */
const MARGEN = 3;

/** Cuántos títulos tienen que aparecer juntos para creer que ese es el encabezado. */
const MINIMO_DE_TITULOS = 4;

function sinAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const igual = (a: string, b: string) => sinAcentos(a) === sinAcentos(b);

export interface TablaLeida {
  filas: FilaDeTabla[];
  /**
   * Lo que está escrito arriba del encabezado como "Etiqueta: valor". En la
   * hoja de FLOW ahí viene la fecha del reparto, que es la del lote entero.
   */
  encabezado: Record<string, string>;
  /** Los títulos que se encontraron, para poder decir cuáles faltaron. */
  titulosEncontrados: string[];
}

export function armarTabla(renglones: Renglon[], forma: FormaDeTabla): TablaLeida {
  /* 1. El encabezado: el renglón donde están casi todos los títulos. */
  let cabecera: Renglon | undefined;
  let cuantos = 0;
  for (const r of renglones) {
    const encontrados = forma.titulos.filter((t) => r.celdas.some((c) => igual(c.texto, t))).length;
    if (encontrados > cuantos) {
      cuantos = encontrados;
      cabecera = r;
    }
  }

  if (!cabecera || cuantos < MINIMO_DE_TITULOS) {
    throw new Error(
      'No se encontró el encabezado de la tabla. ' +
        `Se buscaban las columnas ${forma.titulos.join(', ')} y ` +
        (cuantos ? `sólo aparecieron ${cuantos}.` : 'no apareció ninguna.') +
        ' Puede ser que el comercio haya cambiado el formato del archivo.',
    );
  }

  /* 2. Dónde empieza cada columna. */
  const columnas = forma.titulos
    .map((titulo) => ({
      titulo,
      x: cabecera.celdas.find((c) => igual(c.texto, titulo))?.x,
    }))
    .filter((c): c is { titulo: string; x: number } => c.x !== undefined)
    .sort((a, b) => a.x - b.x);

  // El margen nunca invade la columna de al lado: entre dos títulos pegados se
  // corta al medio.
  const limites = columnas.map((c, i) => {
    const anterior = columnas[i - 1];
    const holgura = anterior ? Math.min(MARGEN, (c.x - anterior.x) / 2) : MARGEN;
    return { titulo: c.titulo, desde: c.x - holgura };
  });

  const columnaDe = (x: number): string | null => {
    let elegida: string | null = null;
    for (const l of limites) if (x >= l.desde) elegida = l.titulo;
    return elegida;
  };

  /* 3. Lo escrito arriba del encabezado: "Fecha: 28/08/2026". */
  const encabezado: Record<string, string> = {};
  for (const r of renglones) {
    if (r.pagina > cabecera.pagina || (r.pagina === cabecera.pagina && r.y <= cabecera.y)) continue;
    for (let i = 0; i < r.celdas.length - 1; i++) {
      const etiqueta = r.celdas[i].texto;
      if (!etiqueta.endsWith(':')) continue;
      encabezado[etiqueta.slice(0, -1).trim()] = r.celdas[i + 1].texto;
    }
  }

  /* 4. Las filas, juntando renglones hasta que aparece el ancla. */
  const filas: FilaDeTabla[] = [];
  let juntando: FilaDeTabla = {};
  let tieneAlgo = false;

  for (const r of renglones) {
    // Todo lo que está arriba del encabezado es título o membrete.
    if (r.pagina < cabecera.pagina || (r.pagina === cabecera.pagina && r.y >= cabecera.y)) continue;

    let cierra = false;
    for (const celda of r.celdas) {
      const col = columnaDe(celda.x);
      if (!col) continue;
      juntando[col] = juntando[col] ? `${juntando[col]} ${celda.texto}` : celda.texto;
      tieneAlgo = true;
      if (col === forma.ancla) cierra = true;
    }

    if (cierra && tieneAlgo) {
      filas.push(juntando);
      juntando = {};
      tieneAlgo = false;
    }
  }

  /*
   * Lo que quedó a medio juntar NO se guarda.
   *
   * Sin ancla no hay forma de saber si es un envío al que le falta el número o
   * el pie de página del archivo, y un envío inventado es peor que uno que
   * falta: el que falta se nota al contar, el inventado sale a la calle.
   */

  return { filas, encabezado, titulosEncontrados: columnas.map((c) => c.titulo) };
}
