/**
 * El link de seguimiento de un envío.
 *
 * SIEMPRE con el dominio real, nunca con el de la ventana. Antes se usaba
 * `window.location.origin` y salía mal: si el repartidor tenía la app abierta
 * desde la dirección de Vercel, el WhatsApp al destinatario le llegaba con ese
 * link en vez de logisticadosruedas.com. Este link sale para afuera, a un
 * cliente que no tiene por qué ver por dónde está publicado el sistema.
 *
 * Se puede pisar con NEXT_PUBLIC_SITE_URL si algún día cambia el dominio.
 */
const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.logisticadosruedas.com').replace(
  /\/+$/,
  '',
);

export function trackUrl(trackingCode: string): string {
  return `${SITIO}/seguimiento/${trackingCode}`;
}
