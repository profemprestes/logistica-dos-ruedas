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
  /**
   * El horario del local, traído de su ficha. `null` si no lo tiene cargado.
   *
   * No vive en la colecta: la colecta guarda el comercio como texto suelto
   * —se puede mandar a retirar a cualquier lado, esté o no dado de alta— y el
   * horario es del comercio. Ver `conHorario`.
   */
  horario: string | null;
  horarioSabado: string | null;
}

/** Sin mayúsculas, sin espacios de más: como se comparan dos textos escritos a mano. */
function parejo(texto: string | null | undefined): string {
  return (texto ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Le pega a cada colecta el horario del comercio al que manda.
 *
 * SE ATA POR NOMBRE Y, SI NO, POR DIRECCIÓN. El nombre es lo que se elige al
 * crear la colecta, así que casi siempre alcanza; la dirección es la red que
 * agarra lo que el nombre deja pasar, y deja pasar: en la base conviven
 * "TOY PIOLA" y "TOYPIOLA" para el mismo local, que es el mismo problema de
 * texto suelto que el paso 40 vino a terminar. Con los dos, hoy atan las once
 * colectas que hay cargadas.
 *
 * Si no ata con ninguno no pasa nada: la colecta se muestra igual, sin
 * horario. Una dirección a la que hay que ir sigue siendo una dirección a la
 * que hay que ir.
 */
async function conHorario(cs: Omit<Colecta, 'horario' | 'horarioSabado'>[]): Promise<Colecta[]> {
  const vacias = cs.map((c) => ({ ...c, horario: null, horarioSabado: null }));
  if (cs.length === 0) return vacias;

  /*
   * Se traen todos los comercios de una y se cruza acá.
   *
   * Son veinte filas: pedirlas de una vez cuesta menos que armar una consulta
   * por colecta, y sobre todo evita el ida y vuelta por cada tarjeta con el
   * celular colgado de la red del centro.
   */
  const { data, error } = await supabase
    .from('clients')
    .select('name, pickup_address, pickup_window, pickup_window_sabado');

  if (error) {
    console.warn('[colectas] no se pudo leer el horario de los comercios', error.message);
    return vacias;
  }

  type Ficha = {
    name: string;
    pickup_address: string | null;
    pickup_window: string | null;
    pickup_window_sabado: string | null;
  };

  const porNombre = new Map<string, Ficha>();
  const porDireccion = new Map<string, Ficha>();
  for (const f of (data ?? []) as Ficha[]) {
    porNombre.set(parejo(f.name), f);
    if (f.pickup_address) porDireccion.set(parejo(f.pickup_address), f);
  }

  return cs.map((c) => {
    const ficha = porNombre.get(parejo(c.comercio)) ?? porDireccion.get(parejo(c.direccion));
    return {
      ...c,
      horario: ficha?.pickup_window ?? null,
      horarioSabado: ficha?.pickup_window_sabado ?? null,
    };
  });
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

  return conHorario((data ?? []) as Omit<Colecta, 'horario' | 'horarioSabado'>[]);
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
 * SÓLO LOS PREASIGNADOS A ÉL y todavía sin retirar. Los que no tienen dueño no
 * se listan: un paquete sin preasignar es uno que en la oficina todavía no se
 * repartió — el local puede tenerlo listo y pasarlo en el momento, y ahí se
 * consulta y se asigna a quien corresponde. Mostrárselo lo invitaría a
 * llevárselo antes de que eso pase, y el escáner no lo frenaría: un envío sin
 * dueño lo toma cualquiera. Esto se probó al revés en el paso 43 y se volvió
 * atrás en el 44.
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
