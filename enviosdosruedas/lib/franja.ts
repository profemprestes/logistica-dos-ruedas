/**
 * Hasta qué hora hay que entregar, según lo que diga la franja.
 *
 * VIVE ACÁ Y NO EN `lib/admin/atrasos.ts` porque ahora lo usan los dos lados:
 * la oficina para avisar que algo se está yendo, y el repartidor para saber
 * qué tiene que hacer primero. Duplicarlo sería garantizar que un día digan
 * cosas distintas sobre el mismo envío — y el día que eso pase, el repartidor
 * va a estar tranquilo mientras la oficina lo llama.
 */

/**
 * Las franjas las escribe la oficina a mano y salen de mil formas —"antes de
 * 19 hs", "ANTES 13HS", "11 a 12:30 hs", "14 A 17HS"— pero todas terminan
 * diciendo una hora límite, y siempre es la ÚLTIMA que aparece en el texto:
 * en "antes de 19" es el 19, y en un rango es el final del rango.
 *
 * Devuelve `null` cuando no hay ninguna hora escrita ("por la mañana", vacío).
 */
export function limiteDeLaFranja(texto: string | null | undefined): number | null {
  if (!texto) return null;

  let limite: number | null = null;
  for (const m of texto.matchAll(/(\d{1,2})(?::(\d{2}))?/g)) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    // Una hora del día y nada más: así un "24/08" perdido en el texto o un
    // número de puerta no se toman por un horario.
    if (h > 23 || min > 59) continue;
    limite = h + min / 60;
  }

  return limite;
}

/**
 * Cuánto falta para el cierre de la franja, en minutos. Negativo si ya pasó.
 *
 * `null` cuando no hay franja escrita: ahí no hay nada que contar y quien
 * llama decide qué hacer con eso.
 */
export function minutosParaElCierre(
  franja: string | null | undefined,
  horaDelDia: number,
): number | null {
  const cierre = limiteDeLaFranja(franja);
  return cierre === null ? null : Math.round((cierre - horaDelDia) * 60);
}

/** "en 35 min", "en 1 h 10 min", "se pasó hace 20 min". */
export function faltaTexto(minutos: number): string {
  const m = Math.abs(minutos);
  const cuanto = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  return minutos < 0 ? `se pasó hace ${cuanto}` : `en ${cuanto}`;
}

/**
 * Hasta qué hora se puede retirar ese envío.
 *
 * MANDA EL DEL ENVÍO Y, SI NO TIENE, EL DEL COMERCIO. El del comercio es el
 * que se carga una vez y vale siempre —"TOY PIOLA, de 9 a 18"—; el del envío
 * es la excepción del día, el "este retiralo antes de las 12 porque el cliente
 * lo pidió", que no tiene por qué cambiarle el horario al local entero.
 *
 * Devuelve el texto además de la hora porque lo que se muestra en pantalla es
 * lo que escribió la oficina, no el número que sacamos nosotros: si alguien
 * escribió "hasta las 13 que cierran por la siesta", esa aclaración vale.
 */
export function horarioDeRetiro(envio: {
  pickup_window?: string | null;
  comercio?: { pickup_window?: string | null } | null;
}): { texto: string; limite: number } | null {
  const texto = (envio.pickup_window ?? envio.comercio?.pickup_window ?? '').trim();
  if (!texto) return null;

  const limite = limiteDeLaFranja(texto);
  return limite === null ? null : { texto, limite };
}

/** La franja tal cual la escribió la oficina, sin que grite. */
export function textoFranja(texto: string | null | undefined): string {
  const t = (texto ?? '').trim();
  // "ANTES 13HS" gritado en el medio de una frase se lee peor que "antes 13hs".
  return t === t.toUpperCase() ? t.toLowerCase() : t;
}
