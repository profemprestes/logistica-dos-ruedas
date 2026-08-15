import { diaAR, horaAR, horaDelDiaAR, hoyAR, type Shipment } from '@/lib/format';

/**
 * Qué se está atrasando, ahora.
 *
 * La oficina no mira la tabla envío por envío: mira si hay algo que se está
 * yendo de las manos. Eso hasta hoy vivía en la cabeza del que atiende —"che,
 * el de Güemes no salió todavía"— y por eso se escapaba justo los días de
 * mucho trabajo, que son los días en que importa.
 *
 * Las cuatro reglas están escritas acá, en un solo lugar y con nombre, para
 * que se puedan discutir y cambiar sin tocar la pantalla. Son a propósito
 * groseras: prefieren avisar de más. Un aviso que no era nada cuesta una
 * mirada; un envío que se olvidó cuesta un cliente.
 *
 * Está separado de la pantalla porque es la parte que se puede equivocar sin
 * que se note: un aviso que no salta no deja rastro. Separado, se prueba.
 */

export type TipoAtraso = 'sin_asignar' | 'sin_retirar' | 'demorado' | 'sin_reprogramar';

export interface Atraso {
  /** Para la lista de React. Único aunque dos avisos sean del mismo tipo. */
  clave: string;
  tipo: TipoAtraso;
  /** El renglón chico de arriba: "SIN ASIGNAR". */
  titulo: string;
  /** De qué envío hablamos. */
  detalle: string;
  /** Desde cuándo viene pasando. Es lo que decide si urge. */
  desde: string;
  /** Rojo lo que no se movió; naranja lo que se está moviendo despacio. */
  tono: 'rojo' | 'naranja';
  accion: string;
  href: string;
}

/**
 * A qué hora deja de ser razonable que un envío siga sin retirar, cuando no
 * hay franja horaria acordada.
 *
 * A las tres de la tarde ya pasó la mañana entera: si a esa hora el comercio
 * todavía no entregó el paquete, o el repartidor no pasó, el envío de hoy
 * corre riesgo de no ser de hoy.
 */
export const CORTE_RETIRO_HS = 15;

/**
 * Cuánto antes del cierre de la franja hay que avisar.
 *
 * Retirar no es entregar: falta ir al comercio, cargarlo y recién después
 * llegar al domicilio, con las paradas que el repartidor tenga en el medio.
 * Dos horas es lo que da para que la entrega todavía entre en la franja.
 */
export const MARGEN_ANTES_DEL_CIERRE_HS = 2;

/**
 * Hasta qué hora hay que entregar, según lo que diga la franja.
 *
 * Las franjas las escribe la oficina a mano y salen de mil formas —"antes de
 * 19 hs", "ANTES 13HS", "11 a 12:30 hs", "14 A 17HS"— pero todas terminan
 * diciendo una hora límite, y siempre es la ÚLTIMA que aparece en el texto:
 * en "antes de 19" es el 19, y en un rango es el final del rango.
 *
 * Devuelve `null` cuando no hay ninguna hora escrita ("por la mañana", vacío).
 * Ahí manda el corte general, que es lo que se hacía siempre.
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
 * Cuánto puede durar un "en camino".
 *
 * Una entrega en Mar del Plata son quince minutos de moto. Hora y media
 * significa que el repartidor se olvidó de cerrarlo, que no encontró la
 * dirección, o que le pasó algo. Las tres cosas se quieren saber.
 */
export const MINUTOS_EN_CAMINO = 90;

/** Los que todavía tienen algo pendiente de hacerse. */
function abierto(s: Shipment): boolean {
  return s.status !== 'entregado' && s.status !== 'cancelado';
}

/** "13/08", del texto de la fecha y sin pasar por el calendario. */
function fechaCorta(fechaISO: string): string {
  const [, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}`;
}

/**
 * Cuándo entró, dicho de forma que no engañe.
 *
 * Un envío cargado ayer decía "entró 13:54" a secas, y eso se lee como las
 * 13:54 de hoy. Si no es de hoy, va el día adelante.
 */
function cuandoEntro(iso: string, hoy: string): string {
  const dia = hoyAR(new Date(iso));
  return dia === hoy ? horaAR(iso) : `${diaAR(iso)} a las ${horaAR(iso)}`;
}

/** "1 h 20 min", "35 min". Los minutos sueltos importan más que la precisión. */
function hace(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

/** La franja tal cual la escribió la oficina, en minúscula y sin sobrar. */
function textoFranja(texto: string | null | undefined): string {
  const t = (texto ?? '').trim();
  // "ANTES 13HS" gritado en el medio de una frase se lee peor que "antes 13hs".
  return t === t.toUpperCase() ? t.toLowerCase() : t;
}

function unEnvio(s: Shipment): string {
  const donde = [s.address_street, s.city].filter(Boolean).join(', ');
  return `${s.tracking_code} · ${donde}`;
}

export interface EntradaAtrasos {
  /** Los de hoy, más los no entregados que sigan sin reprogramar. */
  envios: Shipment[];
  /**
   * Desde cuándo cada envío está "en camino", en milisegundos.
   *
   * No sale de la tabla de envíos: ahí sólo está el estado actual, sin la hora
   * en que se llegó a él. Sale del historial de movimientos, que es el único
   * lugar donde queda registrado cuándo pasó cada cosa.
   */
  enCaminoDesde: Map<number, number>;
  ahora?: Date;
  hoy?: string;
}

export function buscarAtrasos({
  envios,
  enCaminoDesde,
  ahora = new Date(),
  hoy = hoyAR(ahora),
}: EntradaAtrasos): Atraso[] {
  const avisos: Atraso[] = [];
  const deHoy = envios.filter((s) => s.scheduled_date === hoy && abierto(s));
  const t = ahora.getTime();

  // ---- 1. Nadie lo va a llevar --------------------------------------------
  // Van juntos en un solo renglón a propósito: seis envíos sin repartidor son
  // un problema solo —hay que repartirlos— y no seis problemas.
  const sinAsignar = deHoy.filter((s) => !s.assigned_driver);
  if (sinAsignar.length) {
    const masViejo = sinAsignar.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
    avisos.push({
      clave: 'sin-asignar',
      tipo: 'sin_asignar',
      titulo: 'SIN ASIGNAR',
      detalle: `${sinAsignar.length} ${sinAsignar.length === 1 ? 'envío' : 'envíos'} de hoy sin repartidor`,
      desde: `el más viejo entró ${cuandoEntro(masViejo.created_at, hoy)}`,
      tono: 'rojo',
      accion: 'ASIGNAR',
      href: '/admin?repartidor=sin_asignar',
    });
  }

  /*
   * ---- 2. Tiene dueño pero sigue en el comercio ---------------------------
   *
   * LO QUE SE MIRA ES CUÁNTO FALTA PARA EL CIERRE, no hace cuánto se cargó.
   *
   * La primera versión contaba las horas desde `created_at`, y eso está mal
   * para los envíos que se cargan un día antes: uno cargado ayer a las 13:54
   * para hoy amanecía con diecinueve horas encima y saltaba a la madrugada,
   * cuando en realidad no había pasado nada. Y no es un caso raro: de cada
   * diez envíos, más de uno se carga para otro día.
   *
   * El compromiso no es "retirarlo rápido", es "entregarlo dentro de la
   * franja". Así que la cuenta va contra la franja: se avisa cuando ya no
   * queda margen para retirar y llegar a tiempo. Sin franja escrita, manda el
   * corte general de las 15.
   */
  const horaAhora = horaDelDiaAR(ahora);

  for (const s of deHoy) {
    if (!s.assigned_driver) continue;
    if (s.status !== 'creado' && s.status !== 'pendiente_retiro') continue;

    const cierre = limiteDeLaFranja(s.delivery_window);
    const avisarDesde =
      cierre !== null ? cierre - MARGEN_ANTES_DEL_CIERRE_HS : CORTE_RETIRO_HS;

    if (horaAhora < avisarDesde) continue;

    /*
     * Que falte margen y que la franja YA HAYA PASADO no son lo mismo.
     *
     * Lo primero es apurarse; lo segundo es que el compromiso con el
     * destinatario ya se incumplió y alguien tiene que avisarle. Por eso
     * cambia de color: deja de ser algo que se está moviendo despacio.
     */
    const vencida = cierre !== null && horaAhora > cierre;
    const quien = s.driver?.full_name ?? 'Asignado';

    avisos.push({
      clave: `sin-retirar-${s.id}`,
      tipo: 'sin_retirar',
      titulo: vencida ? 'SIN RETIRAR · SE PASÓ LA FRANJA' : 'SIN RETIRAR',
      detalle: unEnvio(s),
      desde: vencida
        ? `${quien} · había que entregarlo ${textoFranja(s.delivery_window)} y todavía está en el comercio`
        : cierre !== null
          ? `${quien} · hay que entregarlo ${textoFranja(s.delivery_window)}`
          : `${quien} · sin franja acordada · corte de retiro ${CORTE_RETIRO_HS} hs`,
      tono: vencida ? 'rojo' : 'naranja',
      accion: 'VER',
      href: `/admin?buscar=${encodeURIComponent(s.tracking_code)}`,
    });
  }

  // ---- 3. Salió y no volvió ------------------------------------------------
  const limiteCamino = t - MINUTOS_EN_CAMINO * 60_000;

  for (const s of deHoy) {
    if (s.status !== 'en_camino') continue;
    const desdeCuando = enCaminoDesde.get(s.id);
    // Sin hora de salida no se inventa: un aviso que no se puede fechar no se
    // puede evaluar, y el que lo lee no sabría si mirarlo o no.
    if (!desdeCuando || desdeCuando > limiteCamino) continue;

    avisos.push({
      clave: `demorado-${s.id}`,
      tipo: 'demorado',
      titulo: `EN CAMINO HACE ${hace(t - desdeCuando)}`,
      detalle: unEnvio(s),
      desde: `${s.driver?.full_name ?? 'Repartidor'} · salió ${horaAR(new Date(desdeCuando))}`,
      tono: 'naranja',
      accion: 'VER MAPA',
      href: '/admin/mapa',
    });
  }

  // ---- 4. Se cerró mal y ahí quedó ----------------------------------------
  // Este es el único que mira más allá de hoy, y es el que más falta hacía: un
  // no entregado sin reprogramar no aparece en ninguna hoja de ruta, así que
  // no lo cruza nadie hasta que llama el comercio.
  for (const s of envios) {
    if (s.status !== 'pendiente_entrega' || s.reprogramado_en) continue;

    avisos.push({
      clave: `sin-reprogramar-${s.id}`,
      tipo: 'sin_reprogramar',
      titulo: 'NO ENTREGADO SIN REPROGRAMAR',
      detalle: unEnvio(s),
      desde: `quedó del ${fechaCorta(s.scheduled_date)} · el comercio espera respuesta`,
      tono: 'rojo',
      accion: 'REPROGRAMAR',
      href: `/admin?buscar=${encodeURIComponent(s.tracking_code)}`,
    });
  }

  // Los rojos primero: son los que nadie está mirando. Los naranjas están en
  // manos de alguien, aunque tarde.
  const peso: Record<Atraso['tono'], number> = { rojo: 0, naranja: 1 };
  return avisos.sort((a, b) => peso[a.tono] - peso[b.tono]);
}
