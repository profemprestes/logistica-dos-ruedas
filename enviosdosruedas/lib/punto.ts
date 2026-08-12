/**
 * Un punto en el mapa, sin buscador de por medio.
 *
 * Está aparte de `lib/geocode.ts` a propósito: eso habla con Nominatim y vive
 * en el servidor; esto es aritmética y texto, y lo usa también el navegador.
 */

export interface Punto {
  lat: number;
  lng: number;
}

/**
 * Marco de Mar del Plata y alrededores, con margen.
 * Cualquier punto afuera de esta caja es un error: se descarta.
 */
export const CAJA = { oeste: -58.1, sur: -38.25, este: -57.3, norte: -37.75 };

/** El centro, para cuando hay que abrir un mapa sin saber todavía dónde. */
export const CENTRO_MDP: Punto = { lat: -38.0055, lng: -57.5426 };

export function dentroDeLaCaja(p: Punto): boolean {
  return (
    p.lat >= CAJA.sur && p.lat <= CAJA.norte && p.lng >= CAJA.oeste && p.lng <= CAJA.este
  );
}

/**
 * Saca un punto de algo pegado a mano.
 *
 * Sirve para la vuelta larga que ya se hace igual: cuando una dirección no la
 * encuentra ningún buscador, se busca en Google Maps, se aprieta el botón
 * derecho sobre la puerta y se copian las coordenadas. Esto entiende eso, y
 * también el link entero de Maps, que es lo que sale de "Compartir".
 *
 * Reconoce:
 *   -38.0231, -57.5789
 *   -38.0231 -57.5789
 *   https://www.google.com/maps/@-38.0231,-57.5789,17z
 *   https://www.google.com/maps/place/X/@-38.02,-57.57,17z/data=!3d-38.0231!4d-57.5789
 *   https://maps.google.com/?q=-38.0231,-57.5789
 */
export function parsearPunto(texto: string): Punto | null {
  const t = String(texto ?? '').trim();
  if (!t) return null;

  const armar = (lat: string, lng: string): Punto | null => {
    const p = { lat: Number(lat), lng: Number(lng) };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    if (Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return null;
    return p;
  };

  // El par !3d!4d del link de Maps es el punto exacto del lugar; el @ que
  // aparece antes es sólo dónde estaba centrada la pantalla al copiarlo.
  const exacto = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (exacto) return armar(exacto[1], exacto[2]);

  const arroba = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (arroba) return armar(arroba[1], arroba[2]);

  const query = t.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  if (query) return armar(query[1], query[2]);

  // Dos números sueltos, y nada más: si hay texto alrededor es una dirección,
  // no unas coordenadas, y confundirlas mandaría el pin a cualquier lado.
  const par = t.match(/^\s*(-?\d{1,3}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})\s*$/);
  if (par) return armar(par[1], par[2]);

  return null;
}

/** `-38.083544, -57.541608`: como lo espera Google Maps si se pega de vuelta. */
export function textoPunto(p: Punto): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}
