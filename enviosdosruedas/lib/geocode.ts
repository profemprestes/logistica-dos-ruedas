/**
 * De "COLON 2749" a un punto en el mapa.
 *
 * Usa Nominatim, el buscador de OpenStreetMap: gratis y sin clave. Su política
 * de uso pide como máximo una consulta por segundo y un User-Agent que diga
 * quién llama — las dos cosas se respetan en `app/api/geocode/route.ts`, que es
 * el único que llama acá. Nunca desde el navegador: sería una consulta por
 * repartidor y nos bloquearían la IP.
 *
 * LA REGLA DE ORO: si no estamos seguros, NO devolvemos punto. Un pin en la
 * cuadra equivocada es peor que ningún pin, porque el repartidor le cree y se
 * va para otro lado. Sin pin, al menos lee la dirección y usa "Cómo llegar",
 * que es lo que hoy funciona bien.
 */

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** Nominatim pide identificarse. Si esto falta, contesta 403. */
const USER_AGENT = 'EnviosDosRuedas/1.0 (+https://www.logisticadosruedas.com)';

/**
 * Marco de Mar del Plata y alrededores, con margen.
 * Cualquier resultado afuera de esta caja es un error del buscador: se descarta.
 */
const CAJA = { oeste: -58.1, sur: -38.25, este: -57.3, norte: -37.75 };

export interface Punto {
  lat: number;
  lng: number;
}

/**
 * Separa "AV DORREGO 172 PLANTA YPF" en calle y altura.
 *
 * Las direcciones vienen como las escribe el comercio: con la altura al final,
 * a veces con texto pegado atrás ("PLANTA YPF", "DEPTO 3"). Se busca el primer
 * número que parezca altura y se tira todo lo que venga después.
 */
export function partirDireccion(texto: string): { calle: string; altura: string } | null {
  const limpio = String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpio) return null;

  const m = limpio.match(/^(.*?)\s+(\d{1,5})(?:\D|$)/);
  if (!m) return { calle: limpio, altura: '' };

  return { calle: m[1].trim(), altura: m[2] };
}

interface FilaNominatim {
  lat: string;
  lon: string;
  category?: string;
  type?: string;
  address?: { house_number?: string; road?: string };
}

/**
 * Búsqueda libre, para que una persona verifique el punto antes de guardar.
 *
 * Es a propósito MÁS PERMISIVA que `geocodificar`: acepta cualquier texto
 * ("YPF Dorrego", "Plaza Mitre") y no exige número de puerta. Puede hacerlo
 * porque del otro lado hay alguien mirando el mapa: la regla estricta existe
 * para cuando nadie mira, no para cuando sí.
 *
 * Devuelve también cómo entendió la dirección, que es lo que le permite al que
 * carga darse cuenta de si el buscador se fue a cualquier lado.
 */
export async function buscarPunto(
  texto: string,
  ciudad: string,
): Promise<(Punto & { etiqueta: string; exacta: boolean }) | null> {
  const consulta = String(texto ?? '').trim();
  if (consulta.length < 3) return null;

  const params = new URLSearchParams({
    q: `${consulta}, ${ciudad || 'Mar del Plata'}, Argentina`,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    viewbox: `${CAJA.oeste},${CAJA.norte},${CAJA.este},${CAJA.sur}`,
    bounded: '1',
  });

  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const filas = (await res.json()) as (FilaNominatim & { display_name?: string })[];
    const fila = filas?.[0];
    if (!fila) return null;

    const lat = Number(fila.lat);
    const lng = Number(fila.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < CAJA.sur || lat > CAJA.norte || lng < CAJA.oeste || lng > CAJA.este) return null;

    return {
      lat,
      lng,
      etiqueta: fila.display_name ?? consulta,
      // Sin número de puerta el punto cae en algún lugar de la calle. Se avisa
      // en pantalla: leyendo sólo la etiqueta no se nota, y en una avenida
      // larga la diferencia son kilómetros.
      exacta: Boolean(fila.address?.house_number),
    };
  } catch {
    return null;
  }
}

/** Saca acentos: en OSM "González Chaves" figura sin ellos la mitad de las veces. */
const sinAcentos = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Busca la dirección. Devuelve `null` cuando no hay una respuesta confiable.
 *
 * Prueba con la calle tal cual y, si no da, sin acentos.
 */
export async function geocodificar(
  direccion: string,
  ciudad: string,
): Promise<Punto | null> {
  const partes = partirDireccion(direccion);
  if (!partes?.calle) return null;

  // Sin altura no hay nada que buscar: ver el comentario de `consultar`.
  if (!partes.altura) return null;

  // "3", "S/N", un número suelto: no es una calle. Probado con datos reales,
  // una dirección así devolvía igual un punto, en cualquier lado.
  if (partes.calle.replace(/[^a-zA-ZñÑ]/g, '').length < 3) return null;

  return (
    (await consultar(partes.calle, partes.altura, ciudad)) ??
    (await consultar(sinAcentos(partes.calle), partes.altura, ciudad))
  );
}

/**
 * Una consulta a Nominatim.
 *
 * ¡OJO! Sólo se acepta el resultado si trae NÚMERO DE PUERTA. Los aciertos a
 * nivel calle parecen buenos y no lo son: probando con direcciones reales,
 * "AV DORREGO 172" cayó a 6 km de "DORREGO 2043", que es la misma avenida. El
 * pin aterriza en cualquier punto de la calle, y en una avenida de sesenta
 * cuadras eso manda al repartidor a otro barrio.
 */
async function consultar(
  calle: string,
  altura: string,
  ciudad: string,
): Promise<Punto | null> {
  const params = new URLSearchParams({
    // Consulta estructurada: es bastante más precisa que mandar todo junto.
    street: `${altura} ${calle}`,
    city: ciudad || 'Mar del Plata',
    country: 'Argentina',
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    // `bounded` obliga a contestar dentro de la caja, o a no contestar.
    viewbox: `${CAJA.oeste},${CAJA.norte},${CAJA.este},${CAJA.sur}`,
    bounded: '1',
  });

  let filas: FilaNominatim[];
  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es' },
      // Si tarda, que falle: el envío ya está guardado, el punto es un extra.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    filas = (await res.json()) as FilaNominatim[];
  } catch {
    return null;
  }

  const fila = filas?.[0];
  if (!fila) return null;

  const lat = Number(fila.lat);
  const lng = Number(fila.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Segunda comprobación de la caja: `bounded` a veces afloja el criterio.
  if (lat < CAJA.sur || lat > CAJA.norte || lng < CAJA.oeste || lng > CAJA.este) return null;

  // Sin calle reconocida no es una dirección: puede ser un barrio entero.
  if (!fila.address?.road) return null;

  // Acá está el filtro que importa: sin número de puerta, no hay pin.
  if (!fila.address.house_number) return null;

  return { lat, lng };
}
