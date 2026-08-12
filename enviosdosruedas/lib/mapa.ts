/**
 * La dirección del mapita de OpenStreetMap, en un solo lugar.
 *
 * Antes cada pantalla armaba la suya y las dos usaban un recuadro casi
 * cuadrado. Como el hueco donde entra el mapa es más ancho que alto, el
 * visor terminaba mostrando de más a los costados y el punto quedaba
 * chiquito y perdido en el medio.
 *
 * Acá el recuadro se calcula CON LA FORMA DEL HUECO: se elige cuántos metros
 * de alto se quieren ver y el ancho sale de la proporción. Así el punto queda
 * centrado de verdad y siempre se ve la misma cantidad de cuadras.
 */

/** Metros que mide un grado, a la latitud de Mar del Plata. */
const METROS_POR_GRADO_LAT = 111_320;
const METROS_POR_GRADO_LNG = 87_700; // 111.320 × cos(38°)

export function mapaEmbedUrl(
  lat: number,
  lng: number,
  {
    /** Ancho dividido alto del recuadro donde se va a mostrar. */
    aspecto = 1.4,
    /** Cuánto se quiere ver de alto. 600 m son unas seis cuadras. */
    metrosAlto = 600,
  } = {},
): string {
  const dLat = metrosAlto / 2 / METROS_POR_GRADO_LAT;
  const dLng = (metrosAlto * aspecto) / 2 / METROS_POR_GRADO_LNG;

  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(',');

  return (
    'https://www.openstreetmap.org/export/embed.html' +
    `?bbox=${encodeURIComponent(bbox)}` +
    `&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`
  );
}
