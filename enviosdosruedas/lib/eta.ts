/**
 * Cuánto falta para que llegue la moto.
 *
 * Es una cuenta, no un ruteo: distancia en línea recta, corregida por lo que
 * las calles dan vuelta, dividida por lo que rinde una moto en Mar del Plata.
 * No hace falta más. Pedirle la ruta real a un servicio externo agregaría una
 * llamada por visita a una página pública, y el número que devolvería tampoco
 * sabría del semáforo de Independencia ni de que el repartidor tiene tres
 * paradas antes que la tuya.
 *
 * Por eso el resultado se muestra SIEMPRE como un rango y con la palabra
 * "aproximadamente" adelante: un "llega en 7 minutos" que no se cumple es
 * peor que no decir nada.
 */

export interface Punto {
  lat: number;
  lng: number;
}

/** Distancia en línea recta, en metros. */
export function distanciaMetros(a: Punto, b: Punto): number {
  const R = 6371000;
  const rad = (g: number) => (g * Math.PI) / 180;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const lat1 = rad(a.lat);
  const lat2 = rad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Lo que se anda de más por ir por las calles y no en línea recta.
 *
 * Mar del Plata es casi todo cuadrícula, así que el desvío es el clásico de
 * una ciudad de manzanas: alrededor de un tercio más que la recta.
 */
const VUELTA = 1.35;

/** Velocidad puerta a puerta de una moto en la ciudad, en km/h. */
const VELOCIDAD = 22;

/** Lo que tarda en estacionar, tocar el timbre y que le abran. */
const MINUTOS_PUERTA = 3;

/**
 * A partir de cuántos minutos sin noticias conviene decirlo en pantalla.
 *
 * No se deja de mostrar la posición —esconderla es peor que mostrarla vieja—
 * pero sí se aclara de cuándo es. Si el repartidor cerró la app o se quedó sin
 * señal, el último punto puede ser de hace rato, y quien mira tiene que
 * saberlo para no ir a buscarlo ahí.
 */
export const MINUTOS_SIN_NOVEDAD = 6;

export interface Estimacion {
  /** Metros por la calle, ya con el desvío aplicado. */
  metros: number;
  /** El rango que se muestra: "entre `desde` y `hasta` minutos". */
  desde: number;
  hasta: number;
  texto: string;
}

/**
 * Devuelve `null` sólo cuando falta alguno de los dos puntos. Con una posición
 * vieja igual estima: el que espera prefiere un número aproximado y saber que
 * hace rato no hay novedades, antes que una pantalla muda.
 */
export function estimarLlegada(
  repartidor: Punto | null,
  destino: Punto | null,
  tomadaEl: string | null,
  ahora: Date = new Date(),
): Estimacion | null {
  if (!repartidor || !destino || !tomadaEl) return null;

  const antiguedadMin = (ahora.getTime() - new Date(tomadaEl).getTime()) / 60000;
  if (!Number.isFinite(antiguedadMin)) return null;

  const metros = distanciaMetros(repartidor, destino) * VUELTA;
  const minutosDeViaje = (metros / 1000 / VELOCIDAD) * 60;

  /*
   * En el rato que pasó desde esa posición la moto siguió andando, así que ese
   * tiempo se descuenta del viaje. Pero SÓLO mientras hay noticias frescas.
   *
   * Descontar sin tope es asumir que siguió viniendo, y eso no se sabe: puede
   * estar parado en una entrega larga, sin señal, o con la app cerrada. Sin el
   * tope, una posición de hace 45 minutos daba "menos de 10 minutos" —el
   * mensaje más peligroso posible, porque manda a alguien a esperar en la
   * puerta— cuando en realidad hace 45 minutos que no sabemos nada.
   *
   * Pasado ese rato el estimado se congela en el último que se pudo calcular,
   * y la pantalla aclara de cuándo es la última señal.
   */
  const descuento = Math.min(antiguedadMin, MINUTOS_SIN_NOVEDAD, minutosDeViaje);
  const minutosViaje = minutosDeViaje - descuento;
  const total = Math.max(1, minutosViaje + MINUTOS_PUERTA);

  // Rango de a cinco minutos, que es la precisión que esto tiene de verdad.
  const desde = Math.max(1, Math.floor(total / 5) * 5);
  const hasta = desde + 5;

  return {
    metros: Math.round(metros),
    desde,
    hasta,
    texto: desde <= 5 ? 'Menos de 10 minutos' : `Entre ${desde} y ${hasta} minutos`,
  };
}

/** Radio del círculo que se dibuja en el mapa, en metros. */
export const RADIO_APROX_M = 500;

/**
 * Lleva el punto al centro de una celda de 500 metros.
 *
 * Es lo que hace que la posición publicada sea aproximada de verdad y no una
 * posición exacta dibujada en chiquito. Dos propiedades que importan:
 *
 *  - El centro que se publica NO es donde está la moto: es el centro de la
 *    celda. La posición real queda en algún lugar adentro, hasta unos 350
 *    metros del centro.
 *  - No hay un corrimiento fijo. Un pin siempre desplazado la misma cantidad
 *    se puede descubrir mirando dónde termina el reparto, y a partir de ahí
 *    se sabe la posición exacta siempre. Con la celda no hay nada que restar:
 *    dos posiciones distintas dentro de la misma manzana publican el mismo
 *    punto.
 *
 * Y como el círculo que se dibuja es de 500 metros, siempre contiene a la moto.
 * El mapa no miente: dice "anda por acá adentro", que es verdad.
 */
export function aproximarPunto(p: Punto): Punto {
  const pasoLat = RADIO_APROX_M / 111_320;
  const pasoLng = RADIO_APROX_M / (111_320 * Math.cos((p.lat * Math.PI) / 180));

  return {
    lat: Math.round(p.lat / pasoLat) * pasoLat,
    lng: Math.round(p.lng / pasoLng) * pasoLng,
  };
}
