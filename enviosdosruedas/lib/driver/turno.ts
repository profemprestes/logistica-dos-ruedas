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
 * Lo último que contestó el servidor, para no volver a arrancar de cero.
 *
 * EL PROBLEMA QUE RESUELVE. Cambiar de pantalla vuelve a montar la hoja de
 * ruta, y preguntar el estado tarda un viaje al servidor. Durante ese medio
 * segundo la app mostraba "No estás conectado" —o sea, afirmaba algo falso— y
 * después saltaba a la hoja de ruta. Se veía en cada cambio de pantalla.
 *
 * Vive en el módulo y no en el componente a propósito: el módulo no se recarga
 * al navegar entre pantallas, así que el valor sobrevive. Se sigue preguntando
 * igual, sólo que ahora mientras tanto se muestra lo último que se sabía en vez
 * de una suposición.
 */
let ultimoConocido: Turno | null = null;

/**
 * Y guardado en el celular, porque la memoria del módulo muere al cerrar la app.
 *
 * Es la misma lección que el portón de permisos: en Chrome minimizar no borra
 * nada, pero el repartidor CIERRA la app de Android todas las noches. Sin esto,
 * la primera apertura de cada día se queda en "cargando" esperando al servidor
 * antes de mostrar la hoja de ruta.
 *
 * Es una suposición, no una verdad, y por eso no cancela la consulta: se
 * muestra lo último que se supo mientras se pregunta, y si cambió se corrige
 * en el mismo segundo.
 */
const GUARDADO = 'edr-turno';

function guardar(t: Turno) {
  ultimoConocido = t;
  try {
    localStorage.setItem(GUARDADO, t.conectado ? String(t.desde?.getTime() ?? Date.now()) : '');
  } catch {
    // Sin donde guardarlo se pierde la mejora, no la función.
  }
}

/** Lo último que se supo, o null si todavía no se preguntó nunca. */
export function turnoConocido(): Turno | null {
  if (ultimoConocido) return ultimoConocido;

  try {
    const crudo = localStorage.getItem(GUARDADO);
    if (crudo === null) return null;
    if (crudo === '') return DESCONECTADO;
    return { conectado: true, desde: new Date(Number(crudo)) };
  } catch {
    return null;
  }
}

/**
 * Cómo está ahora. Pregunta a la base y no a lo que la app se acuerde.
 *
 * Importa que sea así: la conexión se vence sola a las dos horas, y de eso la
 * app no se entera por su cuenta. Si contestara de memoria, el repartidor
 * seguiría viendo "conectado" mientras el servidor ya está descartando sus
 * posiciones — que es la peor combinación posible.
 */
export async function leerTurno(driverId?: string): Promise<Turno> {
  try {
    /*
     * El id se recibe si el que llama ya lo tiene, y lo tiene casi siempre.
     *
     * `getUser()` parece inocente y no lo es: va hasta el servidor a validar el
     * token. Puesto acá, la app hacía DOS viajes seguidos —quién sos, y después
     * si estás conectado— antes de poder dibujar la hoja de ruta. `getSession()`
     * lee lo que ya está en el celular y no viaja a ningún lado.
     */
    let id = driverId;
    if (!id) {
      const { data: sesion } = await supabase.auth.getSession();
      id = sesion.session?.user?.id;
    }
    if (!id) return DESCONECTADO;

    const [{ data: perfil }, { data: vale }] = await Promise.all([
      supabase.from('profiles').select('conectado_desde').eq('id', id).maybeSingle(),
      supabase.rpc('esta_conectado', { p_driver: id }),
    ]);

    const desde = (perfil as { conectado_desde: string | null } | null)?.conectado_desde;

    guardar({
      conectado: vale === true,
      desde: vale === true && desde ? new Date(desde) : null,
    });
    return ultimoConocido!;
  } catch {
    /*
     * Sin internet no se puede saber, y acá conviene NO cambiar nada.
     *
     * Antes se contestaba "desconectado", y eso le sacaba la hoja de ruta al
     * repartidor apenas se metía en un sótano — justo cuando más la necesita y
     * cuando la app está preparada para trabajar sin señal. Se queda con lo
     * último que se supo; el servidor decide igual al reconectar.
     */
    return ultimoConocido ?? DESCONECTADO;
  }
}

/** Arranca la jornada. Devuelve el turno ya leído, o null si falló. */
export async function conectarse(): Promise<Turno | null> {
  const { data, error } = await supabase.rpc('conectarse');

  if (error) {
    console.error('[turno] no se pudo conectar', error.message);
    return null;
  }

  guardar({ conectado: true, desde: data ? new Date(data as string) : new Date() });
  return ultimoConocido!;
}

/** Termina la jornada. A partir de acá no se guarda ninguna posición más. */
export async function desconectarse(): Promise<boolean> {
  const { error } = await supabase.rpc('desconectarse');

  if (error) {
    console.error('[turno] no se pudo desconectar', error.message);
    return false;
  }

  guardar(DESCONECTADO);
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
