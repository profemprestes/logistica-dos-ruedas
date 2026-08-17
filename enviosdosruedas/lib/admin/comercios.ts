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
 * Devuelve el id del comercio para ese nombre, creándolo si hace falta.
 * `null` si no se pudo — y ahí el envío se guarda sin comercio.
 */
export async function asegurarComercio(opciones: {
  nombre: string;
  direccion: string;
  extra?: string;
  notas?: string;
}): Promise<number | null> {
  const nombre = opciones.nombre.trim();
  const direccion = opciones.direccion.trim();

  // Sin nombre no hay comercio que buscar ni crear. Sin dirección tampoco vale
  // la pena: un comercio sin dónde retirar no sirve para nada de lo que esto
  // existe.
  if (!nombre || !direccion) return null;

  try {
    /*
     * Primero se busca por nombre, sin distinguir mayúsculas.
     *
     * Es la misma comparación que hace el índice único de la base (paso 40), y
     * tiene que serlo: si acá se buscara distinto, escribir "toy piola" crearía
     * uno nuevo que la base después rechazaría por repetido.
     */
    const { data: existente } = await supabase
      .from('clients')
      .select('id')
      .ilike('name', nombre)
      .maybeSingle();

    if (existente) return (existente as { id: number }).id;

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

    try {
      let punto = await buscar(direccion);

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
        lat,
        lng,
        active: true,
      })
      .select('id')
      .single();

    if (error) {
      /*
       * La carrera: dos envíos del mismo comercio nuevo guardados a la vez.
       * El segundo choca contra el índice único, y ahí el comercio YA EXISTE
       * —lo creó el primero— así que se lo busca en vez de dar error.
       */
      const { data: reintento } = await supabase
        .from('clients')
        .select('id')
        .ilike('name', nombre)
        .maybeSingle();

      return reintento ? (reintento as { id: number }).id : null;
    }

    return creado.id;
  } catch {
    return null;
  }
}
