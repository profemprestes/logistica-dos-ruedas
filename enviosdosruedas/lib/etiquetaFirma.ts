import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * La firma que protege el link de la etiqueta.
 *
 * POR QUÉ HACE FALTA. La etiqueta lleva el teléfono del destinatario y el monto
 * a cobrar: justo los dos datos que el seguimiento público NO muestra nunca. Y
 * los códigos son correlativos —EDR00001058, EDR00001059—, así que un link
 * abierto del tipo /etiqueta/EDR00001059MDQ se adivina contando: cualquiera
 * podría ir leyendo teléfonos y montos de todos los envíos.
 *
 * Con la firma, el link sólo funciona si lo generó el panel. No hace falta
 * tabla ni sesión: la firma se calcula y se comprueba con una cuenta.
 *
 * Es sólo de servidor. `node:crypto` no existe en el navegador, así que
 * importar esto desde una pantalla rompe el build — que es exactamente el aviso
 * que uno querría si intentara firmar del lado del cliente, donde el secreto
 * quedaría a la vista.
 */

/**
 * De dónde sale el secreto.
 *
 * Si algún día conviene rotarlo sin tocar la clave de Supabase, se define
 * `ETIQUETA_SECRET` y listo; mientras tanto usa la de servicio, que ya está
 * configurada y nunca sale del servidor. De la firma no se puede volver al
 * secreto, así que usarla acá no la expone.
 */
function secreto(): string {
  const s = process.env.ETIQUETA_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error('Falta el secreto para firmar las etiquetas.');
  return s;
}

/** 16 caracteres alcanzan: son 64 bits, no se aciertan probando. */
export function firmarEtiqueta(codigo: string): string {
  return createHmac('sha256', secreto())
    .update(codigo.trim().toUpperCase())
    .digest('hex')
    .slice(0, 16);
}

/**
 * Compara en tiempo constante.
 *
 * Un `===` común corta apenas encuentra el primer carácter distinto, y esa
 * diferencia de tiempo, medida muchas veces, deja ir adivinando la firma de a
 * un carácter. Con 16 caracteres es un ataque de laboratorio, pero comparar
 * bien no cuesta nada.
 */
export function etiquetaFirmada(codigo: string, firma: string): boolean {
  const esperada = Buffer.from(firmarEtiqueta(codigo));
  const recibida = Buffer.from(String(firma ?? ''));
  if (esperada.length !== recibida.length) return false;
  return timingSafeEqual(esperada, recibida);
}
