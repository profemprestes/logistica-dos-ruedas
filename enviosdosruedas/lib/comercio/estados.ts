import { hoyAR, type Shipment } from '@/lib/format';

/**
 * En qué casillero cae cada envío PARA EL COMERCIO.
 *
 * En la base hay siete estados y ninguno se llama como el comercio los
 * nombraría. `pendiente_retiro` y `en_camino` son dos momentos del mismo
 * asunto —el paquete está en movimiento y todavía no llegó—, y a quien lo
 * mandó le importa esa diferencia mucho menos que a la oficina.
 *
 * Así que acá los siete estados se juntan en cinco grupos, que son las cinco
 * preguntas que un comercio se hace: qué está saliendo, qué queda para otro
 * día, qué llegó, qué no se pudo entregar y qué se dio de baja.
 *
 * Vive suelto y sin pantalla adentro para poder probarlo con los envíos de
 * verdad sin abrir el navegador.
 */

export type Grupo = 'en_curso' | 'programado' | 'entregado' | 'no_entregado' | 'cancelado';

export const ORDEN_GRUPOS: Grupo[] = [
  'en_curso',
  'programado',
  'entregado',
  'no_entregado',
  'cancelado',
];

export const NOMBRE_GRUPO: Record<Grupo, string> = {
  en_curso: 'En curso',
  programado: 'Programados',
  entregado: 'Entregados',
  no_entregado: 'No entregados',
  cancelado: 'Cancelados',
};

/** Qué decir cuando ese casillero está vacío. Nunca dejar un hueco mudo. */
export const VACIO_GRUPO: Record<Grupo, string> = {
  en_curso: 'No hay envíos tuyos en la calle en este momento.',
  programado: 'No hay envíos tuyos cargados para los próximos días.',
  entregado: 'Todavía no hay envíos tuyos entregados.',
  no_entregado: 'Ningún envío tuyo quedó sin entregar. Mejor así.',
  cancelado: 'No hay envíos tuyos dados de baja.',
};

/**
 * A qué grupo pertenece un envío.
 *
 * EL ORDEN DE LAS PREGUNTAS IMPORTA. Primero lo que ya terminó, después la
 * fecha: un envío cancelado que estaba cargado para el jueves es un cancelado,
 * no un programado. Al revés, el comercio lo vería esperando un paquete que no
 * va a salir nunca.
 */
export function grupoDe(s: Shipment, hoy: string = hoyAR()): Grupo {
  if (s.status === 'entregado') return 'entregado';
  if (s.status === 'pendiente_entrega') return 'no_entregado';
  if (s.status === 'cancelado') return 'cancelado';
  return s.scheduled_date && s.scheduled_date > hoy ? 'programado' : 'en_curso';
}

/**
 * Si el envío ya terminó su historia.
 *
 * Es lo que decide qué botón mostrar: el que terminó tiene comprobante, el que
 * está en la calle tiene link de seguimiento. Mostrarle un comprobante a un
 * envío que todavía no pasó nada sería mostrarle una hoja en blanco.
 */
export function estaCerrado(g: Grupo): boolean {
  return g === 'entregado' || g === 'no_entregado' || g === 'cancelado';
}

/**
 * Cómo se ordena cada casillero.
 *
 * No es el mismo criterio para todos, y esa es la gracia. En lo que está en la
 * calle, arriba va lo MÁS VIEJO: un envío de hace tres días sin entregar es lo
 * primero que hay que mirar, y si va al final no lo mira nadie. En lo que ya
 * terminó, arriba va lo más nuevo, que es lo que uno viene a buscar.
 */
export function ordenar(grupo: Grupo | 'todos', lista: Shipment[]): Shipment[] {
  const copia = [...lista];
  const dia = (s: Shipment) => s.scheduled_date || s.created_at.slice(0, 10);

  if (grupo === 'en_curso' || grupo === 'programado') {
    return copia.sort((a, b) => dia(a).localeCompare(dia(b)) || a.id - b.id);
  }
  return copia.sort((a, b) => dia(b).localeCompare(dia(a)) || b.id - a.id);
}

/** Busca en lo que un comercio tiene a mano: el código, el nombre, la calle. */
export function coincide(s: Shipment, texto: string): boolean {
  const q = texto.trim().toLowerCase();
  if (!q) return true;
  return [
    s.tracking_code,
    s.recipient_name,
    s.recipient_phone,
    s.address_street,
    s.address_extra,
    s.city,
    s.product_detail,
  ].some((campo) => (campo ?? '').toLowerCase().includes(q));
}

/* ------------------------------------------------------------ los períodos */

/**
 * Desde cuándo mirar. Es el mismo juego que usa el repartidor en su caja, a
 * propósito: si el comercio pregunta por WhatsApp "los del martes", quien
 * atiende tiene que poder mirar exactamente lo mismo que él.
 */
export type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes' | 'todo' | 'fechas';

export const NOMBRE_PERIODO: Record<Periodo, string> = {
  hoy: 'Hoy',
  ayer: 'Ayer',
  semana: 'Últimos 7 días',
  mes: 'Últimos 30 días',
  todo: 'Todos',
  fechas: 'Elegir fechas',
};

export const ORDEN_PERIODOS: Periodo[] = ['hoy', 'ayer', 'semana', 'mes', 'todo', 'fechas'];

/** Le suma (o resta) días a una fecha AAAA-MM-DD, sin pasar por el calendario. */
function correr(fecha: string, dias: number): string {
  const t = Date.parse(`${fecha}T00:00:00`) + dias * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Entre qué dos fechas cae cada período. `null` es "sin límite".
 *
 * SE MIRA `scheduled_date` Y NO CUÁNDO SE CARGÓ. Para el comercio, un envío es
 * del día en que se reparte: uno cargado el jueves a la noche para el viernes
 * es "el del viernes", y buscarlo entre los del jueves sería no encontrarlo.
 */
export function rangoDelPeriodo(
  periodo: Periodo,
  hoy: string,
  desde?: string,
  hasta?: string,
): { desde: string | null; hasta: string | null } {
  switch (periodo) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'ayer':
      return { desde: correr(hoy, -1), hasta: correr(hoy, -1) };
    case 'semana':
      return { desde: correr(hoy, -6), hasta: hoy };
    case 'mes':
      return { desde: correr(hoy, -29), hasta: hoy };
    case 'fechas':
      // Al revés se da vuelta solo: elegir primero el "hasta" es lo normal.
      if (desde && hasta && desde > hasta) return { desde: hasta, hasta: desde };
      return { desde: desde || null, hasta: hasta || null };
    default:
      return { desde: null, hasta: null };
  }
}

/** Si el envío cae dentro del período. Sin fechas, entra todo. */
export function entraEnElPeriodo(
  s: Shipment,
  rango: { desde: string | null; hasta: string | null },
): boolean {
  const dia = s.scheduled_date || s.created_at.slice(0, 10);
  if (rango.desde && dia < rango.desde) return false;
  if (rango.hasta && dia > rango.hasta) return false;
  return true;
}
