/**
 * Traducción de los códigos que tiran las funciones de la base.
 *
 * Postgres devuelve códigos secos (ENVIO_NO_ENCONTRADO) porque son para el
 * programa, no para una persona. Sin esta traducción el repartidor ve eso tal
 * cual en la pantalla y no sabe si tiene que reintentar, llamar a la oficina o
 * seguir viaje.
 */
const TEXT: Record<string, string> = {
  ENVIO_NO_ENCONTRADO: 'Ese envío ya no está en el sistema (lo borraron desde el panel).',
  ENVIO_DE_OTRO: 'Ese envío ahora figura a nombre de otro repartidor.',
  ASIGNADO_A_OTRO: 'Ese envío ya está asignado a otro repartidor.',
  YA_ENTREGADO: 'Ese envío ya figura como entregado.',
  CANCELADO: 'Ese envío está cancelado: no lo lleves.',
  SIN_SESION: 'Se venció la sesión. Volvé a entrar.',
  TIPO_INVALIDO: 'Tipo de cierre inválido.',
  ENVIO_YA_CERRADO: 'Ese envío ya está cerrado.',
  FALTA_RETIRAR: 'Primero marcá "Ya lo retiré": no se puede entregar algo que no retiraste.',
  ESTADO_NO_PERMITIDO: 'Ese cambio de estado no está permitido.',
  ENVIO_PROGRAMADO:
    'Ese envío está cargado para más adelante: no se puede tocar hasta el día que le toca.',
  // --- del paso 34, al escanear ---
  ENVIO_CERRADO: 'Ese envío ya está cerrado: no lo lleves.',
  ENVIO_YA_ASIGNADO_A_OTRO_REPARTIDOR: 'Ese envío ya está asignado a otro repartidor.',
  YA_LO_TENES: 'Ese envío ya lo tenés: está en tu ruta.',
  ENVIO_NO_ENTREGADO:
    'Ese envío quedó como no entregado. Lo tiene que reprogramar la oficina antes de volver a llevarlo.',
  // --- del paso 38, al escanear en un comercio donde va más de uno ---
  PREASIGNADO_A_OTRO: 'Ese paquete no es tuyo: quedó reservado para',
};

/**
 * Códigos donde el detalle que manda la base es parte del mensaje.
 *
 * Casi siempre el detalle es ruido técnico y se descarta. Acá no: saber que el
 * paquete es de Agustín es lo que le dice al repartidor qué hacer con él. Sin
 * el nombre queda un "no podés" que no explica nada y termina en una llamada.
 */
const CON_DETALLE = new Set(['PREASIGNADO_A_OTRO']);

/**
 * Errores que NO tiene sentido reintentar: por más señal que aparezca, el
 * resultado va a ser el mismo. Un envío borrado no vuelve.
 */
const PERMANENT = new Set([
  'ENVIO_NO_ENCONTRADO',
  'ENVIO_DE_OTRO',
  'ASIGNADO_A_OTRO',
  'TIPO_INVALIDO',
  'ENVIO_YA_CERRADO',
  'FALTA_RETIRAR',
  'ESTADO_NO_PERMITIDO',
  // Reintentar no sirve HOY, y mañana serviría: la entrega entraría con fecha
  // vieja y descuadraría el cierre de caja del día. Mejor que salte a la vista.
  'ENVIO_PROGRAMADO',
  'ENVIO_CERRADO',
  'ENVIO_YA_ASIGNADO_A_OTRO_REPARTIDOR',
  'ENVIO_NO_ENTREGADO',
  // No es un error: es que no hay nada que hacer. Reintentarlo daría lo mismo.
  'YA_LO_TENES',
  // Reintentar no lo va a volver suyo. Se destraba desde el panel.
  'PREASIGNADO_A_OTRO',
]);

/** Códigos de Postgres que también son definitivos. */
const PERMANENT_PG = new Set([
  '23503', // foreign_key_violation: el envío que referencia ya no existe
  '22P02', // invalid_text_representation: dato mal formado, no se arregla solo
]);

/** El código puede venir solo o con detalle atrás ("TIPO_INVALIDO: x"). */
function codeOf(message: string): string {
  return message.split(':')[0].trim();
}

export function errorText(message: string): string {
  const code = codeOf(message);
  const base = TEXT[code];
  if (!base) return message;

  if (CON_DETALLE.has(code)) {
    const detalle = message.slice(code.length + 1).trim();
    if (detalle) return `${base} ${detalle}.`;
  }

  return base;
}

export function isPermanentError(message: string, pgCode?: string): boolean {
  if (pgCode && PERMANENT_PG.has(pgCode)) return true;
  return PERMANENT.has(codeOf(message));
}
