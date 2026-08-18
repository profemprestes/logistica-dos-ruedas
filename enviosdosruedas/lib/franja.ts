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

/** Un rato en que el comercio está abierto. `9` y `13.5` son 9:00 y 13:30. */
export interface Tramo {
  desde: number;
  hasta: number;
}

/**
 * Los ratos en que abre, sacados del texto.
 *
 * MUCHOS COMERCIOS CIERRAN AL MEDIODÍA: "9 a 13 hs y 15:30 a 18 hs". Tomar
 * sólo la última hora —que es lo que hace `limiteDeLaFranja`— daría las 18 y
 * se perdería la siesta entera: el repartidor llega a las 13:30, encuentra la
 * persiana baja, y el aviso de "está por cerrar" no salta a las 12:30, que es
 * justo cuando había que salir.
 *
 * Las horas se emparejan en orden: la primera con la segunda, la tercera con
 * la cuarta. Una sola hora suelta ("hasta las 13") es un cierre sin apertura,
 * y ahí se entiende que está abierto desde temprano.
 *
 * Los pares al revés se descartan: "18 a 9" no es un horario, es un error de
 * tipeo, y tomarlo en serio haría que el comercio figure cerrado todo el día.
 */
export function tramosDeHorario(texto: string | null | undefined): Tramo[] {
  if (!texto) return [];

  const horas: number[] = [];
  for (const m of texto.matchAll(/(\d{1,2})(?::(\d{2}))?/g)) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h > 23 || min > 59) continue;
    horas.push(h + min / 60);
  }

  if (horas.length === 1) return [{ desde: 0, hasta: horas[0] }];

  const tramos: Tramo[] = [];
  for (let i = 0; i + 1 < horas.length; i += 2) {
    if (horas[i + 1] > horas[i]) tramos.push({ desde: horas[i], hasta: horas[i + 1] });
  }

  return tramos;
}

/**
 * Cómo está el comercio ahora: abierto y hasta cuándo, o cerrado y hasta
 * cuándo. `null` si no hay horario cargado.
 *
 * La diferencia entre "cerró hasta las 15:30" y "cerró por hoy" es lo que
 * decide si hay que apurarse o si ya está: en el primer caso el paquete sale
 * igual esta tarde, en el segundo queda para mañana y hay que avisarle a
 * alguien.
 */
export type EstadoComercio =
  | { abierto: true; cierraEnMin: number; vuelveAAbrir: number | null }
  | { abierto: false; abreA: number | null };

export function estadoDelComercio(
  texto: string | null | undefined,
  hora: number,
): EstadoComercio | null {
  const tramos = tramosDeHorario(texto);
  if (tramos.length === 0) return null;

  const siguiente = tramos.find((t) => t.desde > hora);
  const actual = tramos.find((t) => hora >= t.desde && hora < t.hasta);

  if (actual) {
    return {
      abierto: true,
      cierraEnMin: Math.round((actual.hasta - hora) * 60),
      vuelveAAbrir: siguiente ? siguiente.desde : null,
    };
  }

  return { abierto: false, abreA: siguiente ? siguiente.desde : null };
}

/** "18:30", "9", de un número de hora. Para escribirlo en un cartel. */
export function comoHora(hora: number): string {
  const h = Math.floor(hora);
  const min = Math.round((hora - h) * 60);
  return min ? `${h}:${String(min).padStart(2, '0')}` : `${h}`;
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
}): string | null {
  const texto = (envio.pickup_window ?? envio.comercio?.pickup_window ?? '').trim();
  return texto || null;
}

/** La franja tal cual la escribió la oficina, sin que grite. */
export function textoFranja(texto: string | null | undefined): string {
  const t = (texto ?? '').trim();
  // "ANTES 13HS" gritado en el medio de una frase se lee peor que "antes 13hs".
  return t === t.toUpperCase() ? t.toLowerCase() : t;
}
