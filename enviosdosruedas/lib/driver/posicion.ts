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

/**
 * Manda la posición cada tanto mientras `hayEnCamino()` diga que sí.
 * Devuelve la función para cortarlo.
 */
export function seguirEnviando(hayEnCamino: () => boolean): () => void {
  const tic = () => {
    if (!navigator.onLine) return;
    if (!hayEnCamino()) return;
    void avisarPosicion();
  };

  // La primera sale enseguida: si no, el que abre el seguimiento justo después
  // de que el repartidor sale no ve nada durante dos minutos.
  tic();
  const timer = window.setInterval(tic, CADA_MS);

  return () => window.clearInterval(timer);
}
