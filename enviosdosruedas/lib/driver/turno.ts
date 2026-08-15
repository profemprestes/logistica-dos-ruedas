'use client';

/**
 * Conectarse y desconectarse: el interruptor de la jornada.
 *
 * Antes el sistema decidía solo, mirando si el repartidor tenía envíos. Eso
 * dejaba ciega a la oficina justo en el caso más útil —el repartidor libre, que
 * es al que le querés dar el próximo retiro— y no le daba al repartidor ninguna
 * forma de decir "hoy no trabajo".
 *
 * Ahora lo decide él. Y como la hoja de ruta no se ve hasta que se conecta,
 * olvidarse no rompe nada: se da cuenta en el primer segundo.
 *
 * LA REGLA VIVE EN LA BASE, no acá (paso 37). Estas funciones sólo preguntan y
 * avisan. Si mañana se cambia el vencimiento de dos horas, se cambia en un solo
 * lugar y vale para la app, para el panel y para cualquier cosa que venga.
 */
import { supabase } from '@/lib/supabaseClient';
import { horaAR } from '@/lib/format';

export interface Turno {
  conectado: boolean;
  /** Desde cuándo, para poder mostrarlo. Null si está desconectado. */
  desde: Date | null;
}

const DESCONECTADO: Turno = { conectado: false, desde: null };

/**
 * Cómo está ahora. Pregunta a la base y no a lo que la app se acuerde.
 *
 * Importa que sea así: la conexión se vence sola a las dos horas, y de eso la
 * app no se entera por su cuenta. Si contestara de memoria, el repartidor
 * seguiría viendo "conectado" mientras el servidor ya está descartando sus
 * posiciones — que es la peor combinación posible.
 */
export async function leerTurno(): Promise<Turno> {
  try {
    const { data: sesion } = await supabase.auth.getUser();
    const id = sesion.user?.id;
    if (!id) return DESCONECTADO;

    const [{ data: perfil }, { data: vale }] = await Promise.all([
      supabase.from('profiles').select('conectado_desde').eq('id', id).maybeSingle(),
      supabase.rpc('esta_conectado', { p_driver: id }),
    ]);

    const desde = (perfil as { conectado_desde: string | null } | null)?.conectado_desde;

    return {
      conectado: vale === true,
      desde: vale === true && desde ? new Date(desde) : null,
    };
  } catch {
    // Sin internet no se puede saber. Se contesta "desconectado" a propósito:
    // es la respuesta que no promete nada que no se pueda cumplir.
    return DESCONECTADO;
  }
}

/** Arranca la jornada. Devuelve el turno ya leído, o null si falló. */
export async function conectarse(): Promise<Turno | null> {
  const { data, error } = await supabase.rpc('conectarse');

  if (error) {
    console.error('[turno] no se pudo conectar', error.message);
    return null;
  }

  return { conectado: true, desde: data ? new Date(data as string) : new Date() };
}

/** Termina la jornada. A partir de acá no se guarda ninguna posición más. */
export async function desconectarse(): Promise<boolean> {
  const { error } = await supabase.rpc('desconectarse');

  if (error) {
    console.error('[turno] no se pudo desconectar', error.message);
    return false;
  }

  return true;
}

/**
 * "desde las 09:14", con la hora de Mar del Plata.
 *
 * Usa `horaAR` y no una cuenta propia: la hora de Argentina ya se calcula en un
 * solo lugar (`lib/format.ts`) porque el servidor corre en UTC, y tener dos
 * versiones de esa cuenta ya nos dio una fecha equivocada una vez.
 */
export function desdeCuando(t: Turno): string {
  return t.desde ? `desde las ${horaAR(t.desde)}` : '';
}
