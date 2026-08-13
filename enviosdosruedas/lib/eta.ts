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
 * A partir de qué antigüedad la posición ya no sirve para estimar nada.
 *
 * Si el repartidor cerró la app o se quedó sin señal, el último punto puede
 * ser de hace media hora. Dar un tiempo calculado sobre eso es inventar.
 */
export const MINUTOS_QUE_VENCE = 15;

export interface Estimacion {
  /** Metros por la calle, ya con el desvío aplicado. */
  metros: number;
  /** El rango que se muestra: "entre `desde` y `hasta` minutos". */
  desde: number;
  hasta: number;
  texto: string;
}

/**
 * Devuelve `null` cuando no se puede estimar con honestidad: sin alguno de los
 * dos puntos, o con una posición vieja.
 */
export function estimarLlegada(
  repartidor: Punto | null,
  destino: Punto | null,
  tomadaEl: string | null,
  ahora: Date = new Date(),
): Estimacion | null {
  if (!repartidor || !destino || !tomadaEl) return null;

  const antiguedadMin = (ahora.getTime() - new Date(tomadaEl).getTime()) / 60000;
  if (!Number.isFinite(antiguedadMin) || antiguedadMin > MINUTOS_QUE_VENCE) return null;

  const metros = distanciaMetros(repartidor, destino) * VUELTA;

  // La posición que se usa ya viene con unos minutos de atraso: en ese rato la
  // moto siguió andando, así que ese tiempo se descuenta del viaje. Sin esto
  // el estimado siempre sobra.
  const minutosViaje = (metros / 1000 / VELOCIDAD) * 60 - antiguedadMin;
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

/**
 * Redondea el punto antes de publicarlo: tres decimales son unos cien metros.
 *
 * Alcanza para ver que la moto viene por el barrio y no para saber en qué
 * puerta está parada.
 */
export function redondearPunto(p: Punto): Punto {
  return {
    lat: Math.round(p.lat * 1000) / 1000,
    lng: Math.round(p.lng * 1000) / 1000,
  };
}
