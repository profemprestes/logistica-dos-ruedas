'use client';

/**
 * Las colectas del repartidor: a dónde tiene que ir a retirar.
 *
 * Una colecta no es un envío. El envío se lo asigna el escaneo —y eso está
 * bien, porque se lleva lo que el comercio efectivamente le da— pero entonces,
 * antes de escanear, el envío no existe para él. Alguien tiene que decirle a
 * dónde ir, y hasta ahora eso vivía en un WhatsApp.
 *
 * Ver el paso 39 para el porqué largo y para las reglas, que viven en la base.
 */
import { supabase } from '@/lib/supabaseClient';

export interface Colecta {
  id: number;
  direccion: string;
  comercio: string | null;
  nota: string | null;
  lat: number | null;
  lng: number | null;
  fecha: string;
}

/**
 * Las que tiene pendientes, la más vieja primero.
 *
 * SE TRAEN TODAS LAS PENDIENTES, no sólo las de hoy. Una colecta de ayer sin
 * hacer sigue siendo un comercio con paquetes esperando: esconderla porque
 * cambió el día sería hacer desaparecer el problema en vez de resolverlo. La
 * fecha se muestra al lado cuando no es de hoy.
 *
 * La política de la base ya limita a las propias: acá no hace falta filtrar por
 * repartidor, y no filtrar es mejor — si mañana cambia la regla, cambia en un
 * solo lugar.
 */
export async function misColectas(): Promise<Colecta[]> {
  const { data, error } = await supabase
    .from('colectas')
    .select('id, direccion, comercio, nota, lat, lng, fecha')
    .is('hecha_at', null)
    .order('fecha', { ascending: true })
    .limit(20);

  if (error) {
    console.warn('[colectas] no se pudieron leer', error.message);
    return [];
  }

  return (data ?? []) as Colecta[];
}

/**
 * "Ya retiré". Devuelve si el servidor la tomó.
 *
 * La hora la pone el servidor (ver `marcar_colecta_hecha`, paso 39): un celular
 * con la hora cambiada escribiría cualquier cosa, y esa hora es la que después
 * se mira para entender por qué un comercio quedó sin retirar.
 */
export async function marcarHecha(id: number): Promise<boolean> {
  const { error } = await supabase.rpc('marcar_colecta_hecha', { p_id: id });

  if (error) {
    console.error('[colectas] no se pudo marcar', error.message);
    return false;
  }

  return true;
}

/**
 * Qué paquetes lo esperan en ese comercio.
 *
 * SÓLO LA DIRECCIÓN DE ENTREGA, nada más. El repartidor todavía no los
 * escaneó, así que no son suyos: mostrarle destinatario, plata a cobrar y
 * franja horaria sería darle datos de envíos que capaz termina llevando otro.
 * Lo que necesita es distinto y más simple — cuántos son y para qué lado van,
 * para saber si le sirven o si tiene que decir que no.
 *
 * Vienen los suyos y los que no tienen dueño, marcados con `mio`. Los sin dueño
 * los toma el que los escanea —así está hecho el escáner y así tiene que
 * quedar— así que esconderlos lo obligaría a preguntar en el mostrador, que es
 * justo lo que esto venía a evitar. Los preasignados a OTRO no vienen: ésos no
 * puede llevárselos ni queriendo.
 *
 * VA POR RPC Y NO LEYENDO LA TABLA. Esto se intentó primero pidiendo los
 * envíos derecho, y la base contestaba vacío: los permisos no dejan ver un
 * envío que todavía no se escaneó. Está bien que sea así —lo que no escaneó no
 * es suyo— pero entonces el repartidor veía "4 paquetes" y ninguna lista, sin
 * error ni aviso, igual que si no hubiera nada. La función del paso 43 corre
 * con permisos propios y devuelve la dirección de entrega y nada más.
 */
export interface Paquete {
  destino: string;
  mio: boolean;
}

export async function paquetesDeLaColecta(direccion: string): Promise<Paquete[]> {
  const { data, error } = await supabase.rpc('paquetes_de_colecta', {
    p_direccion: direccion,
  });

  if (error) {
    console.warn('[colectas] no se pudo saber qué hay que retirar', error.message);
    return [];
  }

  /*
   * `mio` sin definir se toma como suyo.
   *
   * Es el rato entre que sale el código y se corre el paso 43: la función
   * vieja devuelve sólo la dirección, sin decir de quién es, y ahí lo único
   * que devolvía eran los de él. Sin esto la lista quedaría vacía en ese rato
   * —que es el mismo agujero que estamos tapando— y encima sin dar señales.
   */
  return ((data ?? []) as Partial<Paquete>[])
    .filter((p): p is Paquete & { mio?: boolean } => Boolean(p.destino))
    .map((p) => ({ destino: p.destino, mio: p.mio !== false }));
}

/** El link para llegar. Con el punto si lo tiene; si no, con la dirección. */
export function comoLlegar(c: Colecta): string {
  const destino =
    c.lat != null && c.lng != null
      ? `${c.lat},${c.lng}`
      : encodeURIComponent(`${c.direccion}, Mar del Plata, Argentina`);

  return `https://www.google.com/maps/dir/?api=1&destination=${destino}`;
}
