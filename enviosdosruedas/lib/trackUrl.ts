/** Dominio real del sistema, para cuando no hay ventana de dónde sacarlo. */
const DOMINIO = 'https://www.logisticadosruedas.com';

/**
 * El link de seguimiento de un envío.
 *
 * El dominio sale de la ventana y no de una constante: así en la computadora de
 * prueba arma uno de localhost y en producción el real, sin que nadie tenga que
 * acordarse de cambiar nada. Del lado del servidor no hay ventana, y ahí sí se
 * usa el dominio de verdad.
 */
export function trackUrl(trackingCode: string): string {
  const base = typeof window === 'undefined' ? DOMINIO : window.location.origin;
  return `${base}/seguimiento/${trackingCode}`;
}
