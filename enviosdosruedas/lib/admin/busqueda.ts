/**
 * Cómo se entiende lo que pega la oficina en el buscador.
 *
 * Nadie escribe un término de búsqueda: pega lo que le mandó el comercio por
 * WhatsApp. Y lo que le mandó es "BROWN 2055, Mar del Plata", o el teléfono
 * con el +54 adelante, o el código en minúscula. Buscar eso tal cual no
 * encuentra nada —la dirección guardada dice "BROWN 2055" y nada más— y el
 * buscador queda como que no anda, cuando el envío está ahí.
 *
 * Está aparte para poder probarlo: que una búsqueda devuelva de más se ve
 * enseguida, pero que devuelva vacío cuando el envío existe parece lo mismo
 * que "no está".
 */

/** EDR + dígitos + sufijo de ciudad. Acepta pedazos: "edr00001050" sirve. */
export const ES_CODIGO = /^EDR\d{2,10}[A-Z]{0,4}$/i;

/**
 * Palabras que están en casi todas las direcciones y por eso no distinguen
 * ninguna. La ciudad es la peor: todos los envíos son de Mar del Plata.
 */
const NO_DICEN_NADA = new Set([
  'mar',
  'del',
  'plata',
  'mdq',
  'de',
  'la',
  'el',
  'los',
  'las',
  'calle',
  'av',
  'avda',
  'avenida',
  'nro',
  'numero',
  'número',
  'piso',
  'depto',
  'dpto',
  'entre',
  'esquina',
  'esq',
  'y',
]);

/**
 * Las palabras con las que vale la pena buscar, en orden y como mucho tres.
 *
 * Tres alcanzan: el nombre de la calle y la altura ya dejan un solo envío, y
 * cada palabra de más es una condición más que tiene que cumplirse, o sea una
 * chance más de no encontrar nada.
 */
export function palabrasUtiles(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/[(),.;:]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !NO_DICEN_NADA.has(p))
    // Las de una o dos letras no achican nada y sí pueden dejar afuera.
    .filter((p) => p.length >= 3 || /^\d+$/.test(p))
    .slice(0, 3);
}

/**
 * ¿Esto que pegaron es un teléfono?
 *
 * Se pregunta por la forma y no por el largo: "223 555 1234" es un teléfono y
 * "Alberti 2235" no, aunque los dos tengan cuatro dígitos seguidos. Lo que los
 * separa es que en el teléfono casi todo lo que hay son números.
 */
export function esTelefono(texto: string): boolean {
  const digitos = texto.replace(/\D/g, '');
  const sinEspacios = texto.replace(/[\s\-+()]/g, '');
  return digitos.length >= 8 && digitos.length === sinEspacios.length;
}

/**
 * Los últimos ocho dígitos, que es lo único que siempre coincide.
 *
 * El mismo teléfono está guardado como 2235551234, 5492235551234 o
 * +54 223 555-1234 según quién lo cargó y de dónde salió. El final no cambia.
 */
export function colaDelTelefono(texto: string): string {
  return texto.replace(/\D/g, '').slice(-8);
}
