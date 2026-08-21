/**
 * El mensaje que se le manda al comercio cuando se le crea el acceso.
 *
 * VIVE ACÁ Y NO ADENTRO DEL BOTÓN por dos razones. Una: es el texto con el que
 * la empresa se presenta, se corrige seguido y conviene poder encontrarlo sin
 * leer una pantalla entera. La otra: lleva adentro el usuario y la contraseña
 * de un cliente, así que se prueba con casos, como cualquier cuenta de plata.
 *
 * ESTÁ ESCRITO PARA WHATSAPP, no para HTML ni para markdown:
 *
 *   · `*así*` sale en negrita y `_así_` en cursiva. Son de WhatsApp y hay que
 *     dejarlos tal cual.
 *   · Los links van pelados. WhatsApp NO entiende `[texto](url)`: eso se ve
 *     literal, con los corchetes y el paréntesis a la vista, y encima el link
 *     no se puede tocar. Un mensaje de bienvenida que se ve roto es peor que
 *     no mandarlo.
 *   · Los saltos de línea son parte del texto. Sin ellos, las tres cosas que
 *     puede hacer el comercio quedan en un párrafo y no se leen.
 */

/** El sitio, sin la barra del final. */
export const SITIO = (
  process.env.NEXT_PUBLIC_SITE_URL || 'https://www.logisticadosruedas.com'
).replace(/\/+$/, '');

/** El dominio para escribirlo en una frase: sin `https://` adelante. */
const DOMINIO = SITIO.replace(/^https?:\/\//, '');

/**
 * El mensaje de bienvenida, ya con los datos de ese comercio.
 *
 * La contraseña entra tal como se escribió. No se puede leer una contraseña ya
 * puesta —Supabase guarda un resumen irreversible, no la contraseña— así que
 * el único momento en que este mensaje se puede armar completo es cuando el
 * que lo manda la acaba de elegir. Quien llame tiene que asegurarse de tenerla:
 * mandar "Contraseña:" y nada al lado es peor que no mandar nada.
 */
export function mensajeDeBienvenida(usuario: string, clave: string): string {
  return [
    '¡Hola! Te comparto una novedad importante. 🚀',
    '',
    'Además de haber implementado nuestro propio sistema de seguimiento, seguimos sumando actualizaciones para darte mayor seguridad, confianza y control en cada envío.',
    '',
    'Hoy habilitamos tu Perfil de Comercio. Un panel exclusivo donde vas a poder gestionar tus despachos. Desde ahí podés:',
    '✔️ Ver el estado actualizado de tus envíos.',
    '✔️ Acceder a los links de seguimiento y etiquetas.',
    '✔️ Revisar el comprobante de entrega de cada paquete.',
    '_(📌 Aclaración para envíos Flex: en el comprobante solo verás la foto y las coordenadas GPS. Los datos del receptor quedan registrados en Mercado Libre)._',
    '',
    'Por el momento el perfil sirve para este control, pero pronto iremos sumando más herramientas.',
    '',
    '👉 Para ingresar:',
    `Entrá a ${DOMINIO} (opción "Ingreso Comercios") o directo en este link: ${SITIO}/login?como=comercio`,
    '',
    '*Tus datos de acceso:*',
    `👤 Usuario: ${usuario.trim()}`,
    `🔑 Contraseña: ${clave}`,
    '',
    '_Podés cambiar la contraseña desde la sección "Mi cuenta"_',
  ].join('\n');
}
