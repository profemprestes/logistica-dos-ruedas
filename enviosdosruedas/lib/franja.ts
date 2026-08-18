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

/** La franja tal cual la escribió la oficina, sin que grite. */
export function textoFranja(texto: string | null | undefined): string {
  const t = (texto ?? '').trim();
  // "ANTES 13HS" gritado en el medio de una frase se lee peor que "antes 13hs".
  return t === t.toUpperCase() ? t.toLowerCase() : t;
}
