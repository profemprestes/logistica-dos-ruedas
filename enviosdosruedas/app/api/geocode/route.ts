import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  buscarPunto,
  claveDePuerta,
  geocodificar,
  normalizarDireccion,
  partirDireccion,
  type Punto,
} from '@/lib/geocode';

/**
 * Le pone coordenadas a los envíos que no las tienen.
 *
 * Corre en el servidor por dos motivos. Uno, la política de Nominatim: pide un
 * User-Agent que identifique a quien llama y como máximo una consulta por
 * segundo, y desde el navegador sería una consulta por repartidor y por envío.
 * Dos, escribir en `shipments` desde acá va con la clave de servicio, sin pelear
 * con el RLS.
 *
 * Se llama solo al guardar un envío desde el panel, y también se puede llamar
 * sin `ids` para ponerse al día con los que quedaron sin punto.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Cuántos por llamada.
 *
 * A una consulta por segundo, seis son unos siete segundos: entra cómodo en el
 * tiempo que da Vercel. Si quedan más, la respuesta lo dice y se vuelve a
 * llamar. Mejor varias llamadas cortas que una que se corta por la mitad.
 */
const POR_LLAMADA = 6;

/** Nominatim pide 1 por segundo. 1,1 s deja margen para el redondeo. */
const ESPERA_MS = 1100;

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cached: SupabaseClient | null = null;

function getAdminClient(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

async function requireAdmin(request: Request, admin: SupabaseClient) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .single();

  return profile?.role === 'admin' ? data.user : null;
}

interface Fila {
  id: number;
  address_street: string;
  city: string | null;
}

/**
 * ¿Esta dirección ya la ubicamos alguna vez?
 *
 * ES LO QUE MÁS TIEMPO AHORRA. Nominatim no conoce "AV DORREGO 172 PLANTA YPF"
 * ni "J NEWBERY 5005", y no las va a conocer nunca: son las que hoy hay que
 * poner a mano. Pero se repiten —el mismo comercio, la misma planta, el mismo
 * edificio— y ponerlas a mano cada vez es hacer dos veces el mismo trabajo.
 *
 * Mirando lo que ya está guardado, cada punto puesto a mano queda aprendido
 * para siempre. Además sale al instante y sin consultar afuera, así que no
 * gasta el cupo de una consulta por segundo.
 *
 * Se compara la dirección normalizada, no letra por letra: el comercio escribe
 * "Av. Dorrego 172" un día y "AV DORREGO 172" al otro.
 */
async function puntoRecordado(
  admin: SupabaseClient,
  direccion: string,
  ciudad: string,
): Promise<Punto | null> {
  const objetivo = normalizarDireccion(direccion);
  if (objetivo.length < 5) return null;

  // La altura acota la búsqueda a un puñado de filas en vez de traer la tabla
  // entera. Son sólo dígitos, así que no se puede colar nada raro en el patrón.
  const altura = partirDireccion(direccion)?.altura;

  let q = admin
    .from('shipments')
    .select('address_street, city, lat, lng')
    .not('lat', 'is', null)
    .limit(300);

  if (altura) q = q.ilike('address_street', `%${altura}%`);

  const { data } = await q;

  const ciudadObjetivo = normalizarDireccion(ciudad);
  // La misma puerta escrita con una referencia atrás: "AV DORREGO 172 PLANTA
  // YPF" tiene que reconocer al "AV DORREGO 172" que ya ubicamos.
  const puerta = claveDePuerta(direccion);

  const fila = (data ?? []).find((f) => {
    const r = f as { address_street: string; city: string | null };
    const suya = normalizarDireccion(r.address_street);
    const suPuerta = claveDePuerta(r.address_street);
    const coincide = suya === objetivo || (puerta !== null && puerta === suPuerta);
    if (!coincide) return false;
    // Misma calle y altura en otra ciudad es otra puerta. Si alguno de los dos
    // no dice ciudad, no se descarta por eso.
    const c = normalizarDireccion(r.city ?? '');
    return !c || !ciudadObjetivo || c === ciudadObjetivo;
  }) as { lat: number; lng: number } | undefined;

  return fila ? { lat: Number(fila.lat), lng: Number(fila.lng) } : null;
}

export async function POST(request: Request) {
  const admin = getAdminClient();
  if (!admin) {
    return NextResponse.json({ error: 'Falta configurar el servidor.' }, { status: 500 });
  }

  if (!(await requireAdmin(request, admin))) {
    return NextResponse.json({ error: 'Solo un administrador.' }, { status: 403 });
  }

  const { ids, consulta, ciudad } = (await request.json().catch(() => ({}))) as {
    ids?: number[];
    consulta?: string;
    ciudad?: string;
  };

  // Modo verificación: busca y devuelve el punto sin guardar nada. Lo usa el
  // formulario para que el que carga lo vea en el mapa antes de confirmar.
  if (consulta) {
    const recordado = await puntoRecordado(admin, consulta, ciudad ?? 'Mar del Plata');
    if (recordado) {
      return NextResponse.json({
        origen: 'memoria',
        punto: {
          ...recordado,
          etiqueta: 'Esta dirección ya la habías ubicado antes',
          // Sale de un punto que alguien ya dio por bueno: no hay que avisar
          // que puede estar a varias cuadras, porque no lo está.
          exacta: true,
        },
      });
    }

    const punto = await buscarPunto(consulta, ciudad ?? 'Mar del Plata');
    return NextResponse.json({ origen: 'buscador', punto });
  }

  // Sólo los que no tienen punto: geocodificar dos veces lo mismo es gastar
  // el cupo de Nominatim al pedo. Y sólo los que todavía se reparten: el punto
  // sirve para llegar, y a un envío entregado ya no hay que llegarle.
  let q = admin
    .from('shipments')
    .select('id, address_street, city')
    .is('lat', null)
    .not('status', 'in', '(entregado,cancelado)')
    .limit(POR_LLAMADA + 1);

  if (ids?.length) q = q.in('id', ids);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const filas = (data ?? []) as Fila[];
  const tanda = filas.slice(0, POR_LLAMADA);

  let guardados = 0;
  let sinPunto = 0;

  for (const fila of tanda) {
    const ciudadFila = fila.city ?? 'Mar del Plata';

    // Primero la memoria: es instantánea y no gasta el cupo del buscador. Sólo
    // se espera el segundo de rigor cuando de verdad hubo que preguntar afuera.
    let punto = await puntoRecordado(admin, fila.address_street, ciudadFila);

    if (!punto) {
      await dormir(ESPERA_MS);
      punto = await geocodificar(fila.address_street, ciudadFila);
    }

    if (!punto) {
      sinPunto++;
      continue;
    }

    const { error: upError } = await admin
      .from('shipments')
      .update({ lat: punto.lat, lng: punto.lng })
      .eq('id', fila.id);

    if (upError) sinPunto++;
    else guardados++;
  }

  return NextResponse.json({
    procesados: tanda.length,
    guardados,
    sinPunto,
    /** `true` si quedaron más esperando: conviene volver a llamar. */
    quedanMas: filas.length > POR_LLAMADA,
  });
}
