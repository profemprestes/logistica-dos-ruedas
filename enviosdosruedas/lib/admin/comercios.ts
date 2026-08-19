'use client';

/**
 * Los comercios se aprenden solos.
 *
 * LA REGLA: cargar un envío nunca puede obligar a dar de alta un comercio
 * antes. El que carga está apurado, con el celular en la mano y el paquete
 * enfrente; mandarlo a otra pantalla a completar una ficha es la clase de traba
 * que hace que la gente deje de usar el sistema y vuelva al papel.
 *
 * Así que pasa al revés: escribe el comercio y la dirección como siempre, y si
 * ese nombre no existía se crea acá, con su punto buscado. La próxima vez ya
 * está en la lista y no hay que escribir nada.
 *
 * NUNCA ROMPE EL GUARDADO. Si no se puede crear el comercio o no se encuentra
 * el punto, el envío se guarda igual sin comercio: es exactamente como venía
 * funcionando hasta ahora. Perder un envío por no poder ubicar una dirección
 * sería cambiar un problema chico por uno grande.
 */
import { supabase } from '@/lib/supabaseClient';

/**
 * Por qué no se pudo enlazar el último envío. `null` si salió bien.
 *
 * ESTO EXISTE PORQUE FALLABA EN SILENCIO. El 18/08/2026 aparecieron cinco
 * envíos del día sin comercio enlazado —WELIVERY, WAYFARER, AMA Y POLA, todos
 * comercios que ya estaban cargados y con punto— y desde el panel se veían
 * perfectos: el nombre escrito, la dirección escrita, todo bien. Lo único que
 * faltaba era el enlace, y sin él el repartidor no ve el punto de retiro en el
 * mapa y va a la dirección leyéndola de la tarjeta.
 *
 * Cada `return null` de acá abajo era una hipótesis que no se podía comprobar.
 * Ahora cada uno dice cuál fue.
 */
let ultimoProblema: string | null = null;

export function problemaDelComercio(): string | null {
  return ultimoProblema;
}

/**
 * El nombre de un comercio reducido a lo que lo identifica.
 *
 * Minúsculas, sin acentos y sin nada que no sea letra o número: "TOY PIOLA",
 * "toypiola" y "Toy-Piola" dan los tres `toypiola`.
 *
 * ESTO NACIÓ DE UN ENVÍO PERDIDO. El 18/08/2026 se cargó uno como "TOYPIOLA"
 * teniendo la ficha "TOY PIOLA", y como los nombres no coincidían quedó sin
 * enganchar: no salía en el portal del comercio y el repartidor no veía el
 * punto de retiro. Un espacio.
 *
 * Los acentos se CAMBIAN por su letra, no se borran: "OLAVARRÍA" y "OLAVARRIA"
 * tienen que dar los dos `olavarria`. Borrando la í, el primero daría
 * `olavarra` y serían dos comercios distintos otra vez.
 *
 * La regla de verdad vive en la base —columna `nombre_clave` e índice único,
 * paso 50— y esto tiene que dar exactamente lo mismo. Si algún día se cambia
 * una, hay que cambiar la otra.
 */
export function claveDeComercio(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Busca la ficha de ese nombre, sin que un espacio de más la esconda.
 *
 * Si la columna `nombre_clave` todavía no existe —porque se publicó la app
 * antes de correr el paso 50— vuelve a la búsqueda de antes en vez de fallar.
 * Sin esta vuelta atrás, en esa ventana ningún envío se enlazaría, que es
 * bastante peor que enlazar de más.
 */
async function buscarFicha(nombre: string) {
  const porClave = await supabase
    .from('clients')
    .select('id, lat')
    .eq('nombre_clave', claveDeComercio(nombre))
    .maybeSingle();

  if (!porClave.error) return porClave;
  if (!/nombre_clave/.test(porClave.error.message)) return porClave;

  return supabase.from('clients').select('id, lat').ilike('name', nombre).maybeSingle();
}

/**
 * Devuelve el id del comercio para ese nombre, creándolo si hace falta.
 * `null` si no se pudo — y ahí el envío se guarda sin comercio.
 */
export async function asegurarComercio(opciones: {
  nombre: string;
  direccion: string;
  extra?: string;
  notas?: string;
  /** El punto verificado a mano en el mapa, si lo hubo. */
  punto?: { lat: number; lng: number } | null;
  /** El horario de retiro del local: "9 a 18 hs". Ver el paso 48. */
  horario?: string;
}): Promise<number | null> {
  ultimoProblema = null;
  const nombre = opciones.nombre.trim();
  const direccion = opciones.direccion.trim();

  // Sin nombre no hay comercio que buscar ni crear. Sin dirección tampoco vale
  // la pena: un comercio sin dónde retirar no sirve para nada de lo que esto
  // existe.
  if (!nombre || !direccion) {
    ultimoProblema = !nombre
      ? 'no se escribió el nombre del comercio'
      : 'no se escribió la dirección de retiro';
    return null;
  }

  try {
    /*
     * Primero se busca por la clave del nombre: sin espacios, sin acentos y en
     * minúscula. Es la misma comparación que hace el índice único de la base
     * (paso 50), y tiene que serlo: si acá se buscara distinto, escribir
     * "toypiola" crearía uno nuevo que la base después rechazaría por repetido.
     */
    const { data: existente, error: eBuscar } = await buscarFicha(nombre);

    if (eBuscar) {
      ultimoProblema = `no se pudo buscar el comercio: ${eBuscar.message}`;
      return null;
    }

    if (existente) {
      const id = (existente as { id: number; lat: number | null }).id;

      /*
       * Si el comercio ya estaba pero SIN punto, y vos lo verificaste en el
       * mapa al cargar el envío, se lo guardamos.
       *
       * Sólo cuando no tenía. Uno ya verificado no se pisa: el de la ficha se
       * revisó mirando el mapa, y el de acá puede ser el de un envío cargado a
       * las apuradas.
       */
      if (opciones.punto && (existente as { lat: number | null }).lat == null) {
        await supabase
          .from('clients')
          .update({ lat: opciones.punto.lat, lng: opciones.punto.lng })
          .eq('id', id);
      }

      /*
       * El horario SÍ se pisa, al revés que el punto.
       *
       * Un punto verificado en el mapa no mejora con el tiempo: el de la ficha
       * se revisó mirando, y pisarlo con uno buscado a las apuradas sería
       * empeorarlo. El horario es al revés — cambia de verdad, el local corre
       * el cierre en verano — y el que lo está escribiendo lo tiene fresco.
       */
      if (opciones.horario?.trim()) {
        await supabase
          .from('clients')
          .update({ pickup_window: opciones.horario.trim() })
          .eq('id', id);
      }

      return id;
    }

    // Es nuevo: se le busca el punto antes de crearlo.
    const { data: sesion } = await supabase.auth.getSession();
    let lat: number | null = null;
    let lng: number | null = null;

    const buscar = async (texto: string) => {
      const r = await fetch('/api/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sesion.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ consulta: texto, ciudad: 'Mar del Plata' }),
      });

      if (!r.ok) return null;
      const { punto } = (await r.json()) as { punto?: { lat: number; lng: number } | null };
      return punto ?? null;
    };

    /*
     * El punto que verificaste a mano gana sobre el buscador, y ni siquiera se
     * consulta. Vos viste dónde cae en el mapa; Nominatim adivina.
     */
    if (opciones.punto) {
      lat = opciones.punto.lat;
      lng = opciones.punto.lng;
    }

    try {
      let punto = opciones.punto ? null : await buscar(direccion);

      /*
       * Si no la encontró, se reintenta cortando en el número de puerta.
       *
       * Pasa todo el tiempo: se escribe "FRIULI 1972 1A" en la dirección
       * —porque así viene en el WhatsApp— y el "1A" es el piso. Esa dirección
       * no existe y la búsqueda vuelve vacía, así que el comercio quedaría sin
       * punto y el mapa sin poder dibujarlo.
       *
       * Se reintenta sólo si hay algo después del número: si no, sería repetir
       * la misma consulta y gastar el cupo del buscador al pedo.
       */
      if (!punto) {
        // El \b es imprescindible: sin el, "INDEPENDENCIA 2684" se parte en
        // "INDEPENDENCIA 268" + "4" y se guardaria el punto de otra cuadra.
        const m = direccion.match(/^(.*?\s\d{1,5})\b\s*(.+)$/);
        if (m) punto = await buscar(m[1]);
      }

      if (punto) {
        lat = punto.lat;
        lng = punto.lng;
      }
    } catch {
      // Sin punto se crea igual: aparece marcado "sin ubicar" en Comercios y se
      // corrige de a uno, cuando alguien tenga tiempo.
    }

    const { data: creado, error } = await supabase
      .from('clients')
      .insert({
        name: nombre,
        pickup_address: direccion,
        pickup_extra: opciones.extra?.trim() || null,
        pickup_notes: opciones.notas?.trim() || null,
        pickup_window: opciones.horario?.trim() || null,
        lat,
        lng,
        active: true,
      })
      .select('id')
      .single();

    if (error) {
      /*
       * Dos motivos para chocar contra el índice único, y los dos terminan
       * igual: el comercio ya existe, así que se lo busca en vez de dar error.
       *
       *  - La carrera: dos envíos del mismo comercio nuevo guardados a la vez.
       *    Lo creó el primero.
       *  - El mismo nombre escrito distinto: "TOYPIOLA" contra la ficha
       *    "TOY PIOLA". Acá no debería llegar nunca —la búsqueda de arriba ya
       *    lo encuentra— pero si llega, la base lo frena igual.
       */
      const { data: reintento } = await buscarFicha(nombre);

      if (reintento) return (reintento as { id: number }).id;

      ultimoProblema = `no se pudo crear el comercio: ${error.message}`;
      return null;
    }

    return creado.id;
  } catch (err) {
    ultimoProblema = err instanceof Error ? err.message : 'falló sin decir por qué';
    return null;
  }
}
