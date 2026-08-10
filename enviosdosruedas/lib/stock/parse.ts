import type { StockRow } from './types';
import { hoyISO } from './types';

/**
 * Lee el mensaje de entregas del día y dice qué descontar de cada producto.
 *
 * Es la traducción del parser que hoy vive en `stock-edr/server.js`
 * (`analizarTexto`), con el mismo criterio: lo que no entiende NO lo inventa,
 * lo deja marcado para que lo cargues a mano.
 *
 *   23/7
 *   1) Carasa 4205. Cobrar $51900 (Óxido nítrico x2)
 *   2) Meyrelles 3385. Cobrar $36900 (Nad x1)
 *   Efectivo cobrado $196.640
 */

export type MatchState = 'exacto' | 'aproximado' | 'ambiguo' | 'sin_match' | 'sin_texto';

export interface ParsedItem {
  /** Número de línea del mensaje original, para poder señalarla. */
  linea: number;
  fecha: string;
  direccion: string;
  cobrar: number | null;
  /** El texto del producto tal cual venía entre paréntesis. */
  textoProducto: string;
  cantidad: number;
  productId: string | null;
  estado: MatchState;
  /** Candidatos cuando quedó ambiguo, para ofrecerlos en el desplegable. */
  opciones: string[];
  textoOriginal: string;
}

export interface ParsedWarning {
  linea: number;
  texto: string;
  motivo: string;
}

export interface ParseResult {
  items: ParsedItem[];
  avisos: ParsedWarning[];
  totalDeclarado: number | null;
}

/** Saca acentos, mayúsculas y puntuación: así "Óxido nítrico" matchea "oxido nitrico". */
export function normalizar(txt: unknown): string {
  return String(txt ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aNumero(txt: string | undefined | null): number | null {
  if (!txt) return null;
  const limpio = String(txt).replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.]/g, '');
  const n = parseFloat(limpio);
  return Number.isNaN(n) ? null : n;
}

/** "23/7" o "23/7/25" sueltos en una línea cambian la fecha de las que siguen. */
function fechaDesdeLinea(linea: string, anioPorDefecto: number): string | null {
  const m = linea.trim().match(/^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?$/);
  if (!m) return null;
  const dia = String(parseInt(m[1], 10)).padStart(2, '0');
  const mes = String(parseInt(m[2], 10)).padStart(2, '0');
  let anio = m[3] ? parseInt(m[3], 10) : anioPorDefecto;
  if (anio < 100) anio += 2000;
  return `${anio}-${mes}-${dia}`;
}

/** "Creatina x1, Nad x2" -> dos pedazos con su cantidad. */
export function partirProductos(dentroParentesis: string): { nombre: string; cantidad: number }[] {
  return String(dentroParentesis)
    .split(/\s*[,;+]\s*|\s+y\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pedazo) => {
      let cantidad = 1;
      let nombre = pedazo;

      let m = pedazo.match(/^(.*?)\s*[x×]\s*(\d+)$/i); // "Nad x2"
      if (m) {
        nombre = m[1];
        cantidad = parseInt(m[2], 10);
      } else {
        m = pedazo.match(/^(\d+)\s*[x×]\s*(.+)$/i); // "2x Nad"
        if (m) {
          cantidad = parseInt(m[1], 10);
          nombre = m[2];
        }
      }

      return { nombre: nombre.trim(), cantidad: cantidad || 1 };
    })
    .filter((p) => p.nombre);
}

/**
 * Busca el producto por código, por nombre exacto, por nombre parcial y —última
 * chance— por palabras sueltas. Si hay más de un candidato devuelve `ambiguo`
 * con la lista: elegir por vos podría descontar del producto equivocado.
 */
export function buscarProducto(
  nombre: string,
  productos: StockRow[]
): { productId: string | null; estado: MatchState; opciones: string[] } {
  const n = normalizar(nombre);
  if (!n) return { productId: null, estado: 'sin_texto', opciones: [] };

  const porCodigo = productos.find((p) => normalizar(p.codigo) === n);
  if (porCodigo) return { productId: porCodigo.product_id, estado: 'exacto', opciones: [] };

  const exacto = productos.filter((p) => normalizar(p.nombre) === n);
  if (exacto.length === 1) return { productId: exacto[0].product_id, estado: 'exacto', opciones: [] };

  const parciales = productos.filter((p) => {
    const pn = normalizar(p.nombre);
    return pn.includes(n) || n.includes(pn);
  });
  if (parciales.length === 1)
    return { productId: parciales[0].product_id, estado: 'aproximado', opciones: [parciales[0].product_id] };
  if (parciales.length > 1)
    return { productId: null, estado: 'ambiguo', opciones: parciales.map((p) => p.product_id) };

  const palabras = n.split(' ').filter((w) => w.length > 2);
  const porPalabra = productos.filter((p) => {
    const pn = normalizar(p.nombre);
    return palabras.some((w) => pn.includes(w));
  });
  if (porPalabra.length === 1)
    return { productId: porPalabra[0].product_id, estado: 'aproximado', opciones: [porPalabra[0].product_id] };
  if (porPalabra.length > 1)
    return { productId: null, estado: 'ambiguo', opciones: porPalabra.map((p) => p.product_id) };

  return { productId: null, estado: 'sin_match', opciones: [] };
}

export function analizarTexto(
  texto: string,
  productos: StockRow[],
  fechaPorDefecto?: string
): ParseResult {
  const base = fechaPorDefecto || hoyISO();
  const anio = parseInt(base.slice(0, 4), 10);
  const lineas = String(texto ?? '').split(/\r?\n/);
  let fechaActual = base;

  const items: ParsedItem[] = [];
  const avisos: ParsedWarning[] = [];
  let totalDeclarado: number | null = null;

  lineas.forEach((linea, i) => {
    const cruda = linea.trim().replace(/[[\]]+$/g, '').trim();
    if (!cruda) return;

    const f = fechaDesdeLinea(cruda, anio);
    if (f) {
      fechaActual = f;
      return;
    }

    if (/efectivo\s+cobrado|total\s+cobrado|total\s*:/i.test(cruda)) {
      totalDeclarado = aNumero(cruda.replace(/[^\d.,]/g, ''));
      return;
    }

    // Una entrega arranca con "1)" / "1." / "1-".
    if (!/^\d+\s*[).\-]/.test(cruda)) {
      avisos.push({ linea: i + 1, texto: cruda, motivo: 'No parece una línea de entrega, se ignora.' });
      return;
    }

    const cuerpo = cruda.replace(/^\d+\s*[).\-]\s*/, '');
    const parentesis = cuerpo.match(/\(([^)]*)\)/);
    const cobrar = cuerpo.match(/cobrar[^\d$]*\$?\s*([\d.,]+)/i)?.[1];
    const direccion = cuerpo
      .replace(/\([^)]*\)/g, '')
      .replace(/\.?\s*cobrar[^.]*\.?/i, '')
      .replace(/[\s.,-]+$/, '')
      .trim();

    if (!parentesis) {
      avisos.push({ linea: i + 1, texto: cruda, motivo: 'No encontré el producto entre paréntesis.' });
      return;
    }

    const detalles = partirProductos(parentesis[1]);
    if (!detalles.length) {
      avisos.push({ linea: i + 1, texto: cruda, motivo: 'El paréntesis está vacío.' });
      return;
    }

    for (const d of detalles) {
      const match = buscarProducto(d.nombre, productos);
      items.push({
        linea: i + 1,
        fecha: fechaActual,
        direccion,
        cobrar: aNumero(cobrar),
        textoProducto: d.nombre,
        cantidad: d.cantidad,
        productId: match.productId,
        estado: match.estado,
        opciones: match.opciones,
        textoOriginal: cruda,
      });
    }
  });

  return { items, avisos, totalDeclarado };
}

/* ------------------------------------------------------------------ CSV */

/**
 * Lector de CSV/TSV mínimo, con comillas dobles. Alcanza para la planilla de
 * stock (Producto / Código / Cantidad / Mínimo) y evita sumar una dependencia
 * de Excel de medio mega al bundle.
 */
export function parseCSV(texto: string): string[][] {
  const sinBom = texto.replace(/^﻿/, '');
  // Si la primera línea tiene más ; o tabs que comas, ese es el separador.
  const cabecera = sinBom.split(/\r?\n/)[0] ?? '';
  const cuenta = (c: string) => (cabecera.split(c).length - 1);
  const sep = cuenta(';') > cuenta(',') ? ';' : cuenta('\t') > cuenta(',') ? '\t' : ',';

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;

  for (let i = 0; i < sinBom.length; i++) {
    const c = sinBom[i];

    if (enComillas) {
      if (c === '"') {
        if (sinBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') enComillas = true;
    else if (c === sep) {
      fila.push(campo.trim());
      campo = '';
    } else if (c === '\n') {
      fila.push(campo.trim());
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }

  if (campo || fila.length) {
    fila.push(campo.trim());
    filas.push(fila);
  }

  return filas.filter((f) => f.some(Boolean));
}
