/**
 * La dirección de la etiqueta de un envío.
 *
 * Vive aparte de la firma porque esto lo usan las dos puntas —el servidor para
 * armar el link y la página para leerlo— mientras que firmar es cosa del
 * servidor solo.
 */
const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.logisticadosruedas.com').replace(
  /\/+$/,
  '',
);

export function etiquetaUrl(trackingCode: string, firma: string): string {
  return `${SITIO}/etiqueta/${trackingCode}?t=${firma}`;
}
