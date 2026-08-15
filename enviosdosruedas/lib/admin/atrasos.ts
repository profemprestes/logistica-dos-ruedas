import type { Shipment } from '@/lib/format';
import { hoyLocal } from '@/lib/scheduled';

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
 * A qué hora deja de ser razonable que un envío siga sin retirar.
 *
 * A las tres de la tarde ya pasó la mañana entera: si a esa hora el comercio
 * todavía no entregó el paquete, o el repartidor no pasó, el envío de hoy
 * corre riesgo de no ser de hoy.
 */
export const CORTE_RETIRO_HS = 15;

/** O antes, si el envío ya lleva demasiado cargado sin que nadie lo toque. */
export const HORAS_SIN_RETIRAR = 4;

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

/**
 * "14:35". A mano y no con `toLocaleTimeString`, que acá devolvía
 * "01:54 p. m." — media pantalla para decir la hora, y en un tablero donde
 * todas las horas se leen de reojo y comparadas entre sí.
 */
function hora(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "13/08", del texto de la fecha y sin pasar por el calendario. */
function fechaCorta(fechaISO: string): string {
  const [, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}`;
}

/** "1 h 20 min", "35 min". Los minutos sueltos importan más que la precisión. */
function hace(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
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
  hoy = hoyLocal(),
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
      desde: `el más viejo entró ${hora(masViejo.created_at)} · corte de retiro ${CORTE_RETIRO_HS} hs`,
      tono: 'rojo',
      accion: 'ASIGNAR',
      href: '/admin?repartidor=sin_asignar',
    });
  }

  // ---- 2. Tiene dueño pero sigue en el comercio ---------------------------
  const limiteCarga = t - HORAS_SIN_RETIRAR * 3_600_000;
  const pasoElCorte = ahora.getHours() >= CORTE_RETIRO_HS;

  for (const s of deHoy) {
    if (!s.assigned_driver) continue;
    if (s.status !== 'creado' && s.status !== 'pendiente_retiro') continue;

    const viejo = Date.parse(s.created_at) < limiteCarga;
    if (!pasoElCorte && !viejo) continue;

    avisos.push({
      clave: `sin-retirar-${s.id}`,
      tipo: 'sin_retirar',
      titulo: viejo ? `SIN RETIRAR HACE ${hace(t - Date.parse(s.created_at))}` : 'SIN RETIRAR',
      detalle: unEnvio(s),
      desde: `${s.driver?.full_name ?? 'Asignado'} · cargado ${hora(s.created_at)}`,
      tono: 'naranja',
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
      desde: `${s.driver?.full_name ?? 'Repartidor'} · salió ${hora(new Date(desdeCuando).toISOString())}`,
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
