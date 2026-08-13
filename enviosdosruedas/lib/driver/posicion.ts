/**
 * Avisar por dónde va la moto, mientras haya algo en camino.
 *
 * Es lo que hace que el que espera el paquete vea cuánto falta. Tres cosas que
 * NO hace, y que son el motivo de que esto sea aceptable:
 *
 *  - No manda nada si el repartidor no tiene ningún envío en camino. Lo
 *    controla la app para no gastar batería, y lo vuelve a controlar el
 *    servidor para que sea de verdad (ver `registrar_posicion`, paso 20).
 *  - No guarda un historial: la base se limpia sola a las tres horas.
 *  - No se publica en vivo. El seguimiento muestra la posición con unos
 *    minutos de atraso, y ese atraso lo pone el servidor.
 *
 * Si falla, falla en silencio. Es una comodidad para el cliente final; que el
 * repartidor vea un error rojo porque el GPS tardó sería mucho peor.
 */
import { supabase } from '@/lib/supabaseClient';
import { getFix } from '@/lib/driver/geo';

/**
 * Cada cuánto se manda.
 *
 * Dos minutos es el equilibrio: el estimado no se queda viejo y el GPS no se
 * come la batería de una jornada de ocho horas. Tampoco tiene sentido afinar
 * más, porque lo que se publica va con varios minutos de atraso igual.
 */
export const CADA_MS = 120_000;

/** Manda una posición. Devuelve si el servidor la aceptó. */
export async function avisarPosicion(): Promise<boolean> {
  try {
    // Tolerante: no hace falta precisión de un metro para decir "viene por
    // Independencia", y esperar el punto exacto gasta batería al pedo.
    const fix = await getFix(15_000);
    if (!fix) return false;

    const { data, error } = await supabase.rpc('registrar_posicion', {
      p_lat: fix.lat,
      p_lng: fix.lng,
      p_accuracy_m: fix.accuracy,
    });

    if (error) {
      console.warn('[posicion] el servidor no la tomó', error.message);
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}

/** Cuándo se mandó la última, para no repetir de gusto. */
let ultimoEnvio = 0;

/**
 * Manda la posición cada tanto mientras `hayEnCamino()` diga que sí.
 * Devuelve la función para cortarlo.
 *
 * OJO CON EL RELOJ. El navegador de un celular frena los temporizadores de una
 * pestaña que no está a la vista, y el repartidor se pasa el día saltando a
 * Maps y a WhatsApp. O sea que este intervalo NO corre mientras trabaja: es la
 * red de seguridad, no el mecanismo principal.
 *
 * Lo que de verdad manda posiciones son los momentos en que la app está en
 * pantalla: cuando vuelve al frente, y cuando el repartidor toca "salgo en
 * camino" (eso lo dispara la hoja de ruta llamando a `avisarPosicion`).
 */
export function seguirEnviando(hayEnCamino: () => boolean): () => void {
  const tic = () => {
    if (!navigator.onLine) return;
    if (!hayEnCamino()) return;
    if (Date.now() - ultimoEnvio < CADA_MS) return;
    ultimoEnvio = Date.now();
    void avisarPosicion();
  };

  tic();
  const timer = window.setInterval(tic, CADA_MS);

  // Volver a la app es el momento más confiable que hay para tomar posición:
  // la pantalla está prendida y el GPS despierto.
  const alVolver = () => {
    if (document.visibilityState === 'visible') tic();
  };
  document.addEventListener('visibilitychange', alVolver);

  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', alVolver);
  };
}

/**
 * Manda una posición ahora mismo, salteando la espera del intervalo.
 *
 * Es lo que se llama al marcar "salgo en camino": sin esto, el que abre el
 * seguimiento en ese momento no ve nada hasta el próximo tic, y con el atraso
 * de publicación eso son varios minutos mirando una pantalla que parece rota.
 */
export function avisarPosicionYa(): void {
  ultimoEnvio = Date.now();
  void avisarPosicion();
}
