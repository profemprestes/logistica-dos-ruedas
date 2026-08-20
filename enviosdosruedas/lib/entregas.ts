import { supabase } from '@/lib/supabaseClient';
import type { Shipment } from '@/lib/format';

/**
 * Un envío con varias entregas.
 *
 * EL CASO. EL CONDOR despacha los viernes dos paquetes que salen del mismo
 * retiro y van a dos direcciones. Para el comercio es un envío y paga un
 * precio; para la calle son dos entregas, cada una con su destinatario, su
 * punto en el mapa, su foto y su estado.
 *
 * CÓMO SE GUARDA. Cada entrega es un envío entero. Las que no son la primera
 * tienen `parte_de` apuntando a la primera —la CABEZA—, que es la única que
 * lleva el precio; las otras van en cero. Así la plata se cobra una vez sin
 * tener que enseñarle a sumar distinto a cada pantalla: el cierre de caja, los
 * resúmenes y las estadísticas suman `shipping_fee` como siempre y les da bien
 * solo.
 *
 * LO QUE SÍ HAY QUE ENSEÑARLES. Que una entrega en cero puede no ser un olvido
 * (ver `lib/settlement.ts`), y que al repartidor hay que DECIRLE que ese paquete
 * tiene un hermano: es lo único que evita que se vaya del comercio con uno.
 */

/** Lo mínimo que hace falta saber de una entrega para nombrarla. */
export interface Entrega {
  id: number;
  tracking_code: string;
  address_street: string;
  recipient_name: string | null;
  status: string;
  parte_de: number | null;
  shipping_fee: number | null;
  scheduled_date: string | null;
}

export interface Grupo {
  /** El id de la cabeza: la entrega que lleva el precio. */
  cabeza: number;
  /** Todas las entregas del envío, la cabeza primero. */
  entregas: Entrega[];
}

/** Lo que se muestra al lado de un envío que tiene hermanos. */
export interface Puesto {
  /** 1 para la cabeza, 2 para la segunda… */
  numero: number;
  total: number;
  esCabeza: boolean;
  grupo: Grupo;
}

/** Los envíos ya cargados en pantalla, con lo poco que se les pide. */
export type Cargado = Pick<Entrega, 'id'> & Partial<Entrega>;

export type Puestos = Map<number, Puesto>;

const CAMPOS =
  'id, tracking_code, address_street, recipient_name, status, parte_de, shipping_fee, scheduled_date';

/**
 * Arma los grupos de una tanda de envíos ya cargados, y va a buscar los
 * hermanos que falten.
 *
 * POR QUÉ VA A BUSCARLOS. Casi siempre están: las dos entregas se cargan el
 * mismo día para el mismo comercio, así que el panel ya las tiene las dos. Pero
 * no siempre. Si una no se entregó y se reprogramó para mañana, quedan en días
 * distintos; y si el reparto se dividió, un repartidor puede tener una sola. En
 * los dos casos, mostrar la que está SIN DECIR que hay otra es peor que no
 * mostrar nada: el que la mira cree que el envío está completo.
 *
 * Son dos o tres consultas chicas, y sólo las que hagan falta.
 */
export async function conHermanos(cargados: Cargado[]): Promise<Puestos> {
  const ids = cargados.map((s) => s.id);
  if (!ids.length) return new Map();

  const porId = new Map<number, Entrega>();

  /*
   * Se arranca con lo que ya está en pantalla y recién después se pregunta.
   *
   * Así el celular del repartidor, que trabaja sin señal la mitad del día,
   * igual muestra el cartel: sus dos entregas están las dos en su hoja de ruta,
   * o sea que la respuesta ya la tiene en la mano. La consulta agrega los casos
   * raros —una entrega reprogramada a otro día, o repartida entre dos motos—,
   * y si no sale, no rompe nada.
   *
   * Si el paso 53 todavía no se corrió, `parte_de` no viene en las filas y acá
   * no entra ninguna: no hay grupos, y el resto de la pantalla sigue igual.
   */
  for (const s of cargados) {
    if (esEntrega(s)) porId.set(s.id, s);
  }

  /*
   * Las partes de todo lo cargado. Con esto una cabeza se entera de que tiene
   * hermanos aunque el hermano esté filtrado, sea de otro día o lo tenga otro
   * repartidor.
   */
  const primero = await supabase.from('shipments').select(CAMPOS).in('parte_de', ids);

  if (primero.error) return agrupar(porId);

  guardar(porId, primero.data);

  /*
   * Y las cabezas de las partes que estaban cargadas. Sin esto, una segunda
   * entrega sabe que es parte de algo pero no de qué: mostraría "entrega 2 de
   * 1", que es peor que no decir nada.
   */
  const faltan = [
    ...new Set(
      [...porId.values()]
        .map((e) => e.parte_de)
        .filter((x): x is number => x != null && !porId.has(x)),
    ),
  ];

  if (faltan.length) {
    const cabezas = await supabase.from('shipments').select(CAMPOS).in('id', faltan);
    guardar(porId, cabezas.data);

    // Esas cabezas pueden tener OTRAS partes que nadie pidió: sin esto, un
    // envío de tres entregas se contaría como de dos.
    const masPartes = await supabase.from('shipments').select(CAMPOS).in('parte_de', faltan);
    guardar(porId, masPartes.data);
  }

  return agrupar(porId);
}

function guardar(porId: Map<number, Entrega>, filas: unknown) {
  for (const f of (filas ?? []) as Entrega[]) porId.set(f.id, f);
}

/** Si el envío que vino de la pantalla trae lo que hace falta para agrupar. */
function esEntrega(s: Cargado): s is Entrega {
  return typeof s.tracking_code === 'string' && s.parte_de !== undefined;
}

/**
 * Junta las entregas sueltas en grupos y le pone a cada una su puesto.
 *
 * Está exportada y sin base de datos adentro para poder probarla sola: las
 * reglas de qué es un grupo y en qué orden van las paradas son lo que hay que
 * poder revisar, y meterlas atrás de una consulta las vuelve imposibles de
 * mirar.
 */
export function agrupar(porId: Map<number, Entrega>): Puestos {
  const porCabeza = new Map<number, Entrega[]>();

  for (const e of porId.values()) {
    // Una parte cuya cabeza no se pudo traer se deja afuera: mejor sin cartel
    // que con uno que miente.
    if (e.parte_de != null && !porId.has(e.parte_de)) continue;

    const cabeza = e.parte_de ?? e.id;
    const lista = porCabeza.get(cabeza) ?? [];
    lista.push(e);
    porCabeza.set(cabeza, lista);
  }

  const puestos: Puestos = new Map();

  for (const [cabeza, sueltas] of porCabeza) {
    if (sueltas.length < 2) continue; // un envío de una sola entrega no es un grupo

    // La cabeza primero y las demás por id: el orden en que se cargaron, que es
    // el orden en que él las escribió.
    const entregas = [...sueltas].sort((a, b) =>
      a.id === cabeza ? -1 : b.id === cabeza ? 1 : a.id - b.id,
    );

    const grupo: Grupo = { cabeza, entregas };

    entregas.forEach((e, i) => {
      puestos.set(e.id, { numero: i + 1, total: entregas.length, esCabeza: e.id === cabeza, grupo });
    });
  }

  return puestos;
}

/** "Entrega 2 de 3". Lo que va en el cartelito. */
export function comoSeLlama(p: Puesto): string {
  return `Entrega ${p.numero} de ${p.total}`;
}

/** Las otras entregas del mismo envío, para nombrarlas. */
export function lasOtras(p: Puesto, id: number): Entrega[] {
  return p.grupo.entregas.filter((e) => e.id !== id);
}

/**
 * Ata varias entregas en un solo envío.
 *
 * La cabeza es la primera que se cargó, y se lleva el precio más alto del
 * grupo. No se suman: el comercio paga UN envío. Si el precio tiene que ser
 * otro, se edita la cabeza como cualquier envío.
 */
export async function unir(
  envios: (Pick<Shipment, 'id' | 'client_id' | 'shipping_fee' | 'tracking_code'> & {
    parte_de?: number | null;
  })[],
): Promise<{ error?: string; cabeza?: number; precio?: number }> {
  if (envios.length < 2) return { error: 'Elegí al menos dos entregas.' };

  const clientes = new Set(envios.map((s) => s.client_id));
  if (clientes.size > 1) {
    return {
      error: 'Son de comercios distintos. Un envío con varias entregas es de un comercio solo.',
    };
  }
  if (clientes.has(null)) {
    return { error: 'Alguna no tiene comercio enlazado. Enlazala primero y después unilas.' };
  }

  /*
   * Si alguna ya es parte de otro envío, se para. Moverla sola dejaría el envío
   * viejo con una entrega menos y el precio donde estaba: para eso está
   * "Separar".
   */
  const yaAtada = envios.find((s) => s.parte_de != null);
  if (yaAtada) {
    return { error: `${yaAtada.tracking_code} ya es parte de otro envío. Separala primero.` };
  }

  const ordenadas = [...envios].sort((a, b) => a.id - b.id);
  const cabeza = ordenadas[0];
  const precio = Math.max(...envios.map((s) => Number(s.shipping_fee) || 0));

  const { error: e1 } = await supabase
    .from('shipments')
    .update({ shipping_fee: precio })
    .eq('id', cabeza.id);
  if (e1) return { error: traducir(e1.message) };

  const { error: e2 } = await supabase
    .from('shipments')
    .update({ parte_de: cabeza.id, shipping_fee: 0 })
    .in(
      'id',
      ordenadas.slice(1).map((s) => s.id),
    );
  if (e2) return { error: traducir(e2.message) };

  return { cabeza: cabeza.id, precio };
}

/**
 * Desata una entrega: vuelve a ser un envío suelto.
 *
 * Queda en $ 0 a propósito. Separarla no dice cuánto vale por su cuenta, y
 * ponerle el precio de la cabeza cobraría dos veces lo mismo. En cero salta
 * sola en el cierre de caja como "sin precio", que es exactamente lo que hay
 * que ir a mirar.
 */
export async function separar(id: number): Promise<{ error?: string }> {
  const { error } = await supabase.from('shipments').update({ parte_de: null }).eq('id', id);
  return error ? { error: traducir(error.message) } : {};
}

function traducir(mensaje: string): string {
  if (/parte_de/.test(mensaje)) {
    return 'Falta correr el paso 53 en la base. Hasta entonces no se pueden unir entregas.';
  }
  return mensaje;
}
