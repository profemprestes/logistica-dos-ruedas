/**
 * Una búsqueda de dirección por vez.
 *
 * Cuando se pegan veinte envíos de WhatsApp, las veinte filas quieren buscar su
 * punto al mismo tiempo. Nominatim —el buscador de OpenStreetMap, que es
 * gratis— pide como máximo una consulta por segundo, y veinte de golpe son un
 * bloqueo de IP para todos.
 *
 * Así que se hacen de a una, en fila. Las filas se van completando de arriba
 * hacia abajo mientras el que carga revisa los otros campos; para cuando llega
 * al final, los puntos ya están.
 *
 * La espera se saltea cuando el punto salió de la memoria —una dirección que ya
 * habíamos ubicado antes— porque eso no consulta a nadie: sale de nuestra base.
 * En una tanda de un mismo comercio, que repite la dirección de retiro, casi
 * todas caen ahí y la fila vuela.
 */

/** Lo que pide Nominatim, con un poco de aire. */
const ESPERA_MS = 1_100;

let cadena: Promise<unknown> = Promise.resolve();

export interface ResultadoBusqueda {
  /** 'memoria' cuando salió de nuestra base y no del buscador de afuera. */
  origen?: 'memoria' | 'buscador';
}

export function encolarBusqueda<T extends ResultadoBusqueda>(
  tarea: () => Promise<T>,
): Promise<T> {
  const mia = cadena.then(async () => {
    const r = await tarea();
    if (r?.origen !== 'memoria') {
      await new Promise((ok) => setTimeout(ok, ESPERA_MS));
    }
    return r;
  });

  // La fila no se puede cortar porque una búsqueda falle: si no, el primer
  // error deja sin punto a todas las que venían atrás.
  cadena = mia.catch(() => undefined);

  return mia;
}
