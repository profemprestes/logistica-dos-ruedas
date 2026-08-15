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
import { mandarPosicionNativa, seguirEnviandoNativo } from '@/lib/driver/nativo';

/**
 * Cada cuánto se manda.
 *
 * Dos minutos es el equilibrio: el estimado no se queda viejo y el GPS no se
 * come la batería de una jornada de ocho horas. Tampoco tiene sentido afinar
 * más, porque lo que se publica va con varios minutos de atraso igual.
 */
export const CADA_MS = 120_000;

/** Cuándo se mandó la última, para no repetir de gusto. */
let ultimoEnvio = 0;

/** Y desde dónde, para saber si vale la pena mandar de nuevo. */
let ultimoPunto: { lat: number; lng: number } | null = null;

/**
 * Sube un punto ya tomado. Devuelve si el servidor lo aceptó.
 *
 * Está separado de `avisarPosicion` porque el seguimiento en vivo ya tiene la
 * posición en la mano: pedirle otra al GPS para mandar la misma sería gastar
 * batería para nada.
 */
export async function guardarPosicion(
  lat: number,
  lng: number,
  accuracy?: number | null,
): Promise<boolean> {
  /*
   * En la app de Android el pedido sale por afuera del navegador.
   *
   * No es capricho: con la app atrás, Android estrangula la red del navegador
   * de adentro a los cinco minutos, que es justo el rato que la app existe
   * para cubrir. El porqué largo está en `lib/driver/nativo.ts`. Desde un
   * navegador devuelve null y sigue todo como siempre.
   */
  const porNativo = await mandarPosicionNativa(lat, lng, accuracy ?? null);
  if (porNativo !== null) return porNativo;

  try {
    const { data, error } = await supabase.rpc('registrar_posicion', {
      p_lat: lat,
      p_lng: lng,
      p_accuracy_m: accuracy ?? null,
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

/** Pide una posición al GPS y la manda. */
export async function avisarPosicion(): Promise<boolean> {
  // Tolerante: no hace falta precisión de un metro para decir "viene por
  // Independencia", y esperar el punto exacto gasta batería al pedo.
  const fix = await getFix(15_000);
  if (!fix) return false;
  ultimoPunto = { lat: fix.lat, lng: fix.lng };
  return guardarPosicion(fix.lat, fix.lng, fix.accuracy);
}

/** Nunca más de una por minuto, aunque el GPS avise cada dos segundos. */
const MINIMO_ENTRE_ENVIOS = 60_000;

/** Salvo que se haya movido esto, y entonces vale la pena aunque sea antes. */
const METROS_PARA_MANDAR = 150;

/** Distancia rápida y suficiente para decidir si mandar: no hace falta más. */
function distanciaAprox(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

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
export function seguirEnviando(hayTrabajo: () => boolean): () => void {
  const mandar = (lat: number, lng: number, accuracy: number) => {
    ultimoEnvio = Date.now();
    ultimoPunto = { lat, lng };
    void guardarPosicion(lat, lng, accuracy);
  };

  /**
   * El freno, compartido por las dos fuentes que avisan seguido: el
   * `watchPosition` del navegador y el GPS de Android. Las dos pueden tirar
   * varias posiciones por minuto andando, y el mapa no se ve distinto por eso.
   */
  const mandarSiVale = (lat: number, lng: number, accuracy: number) => {
    const rato = Date.now() - ultimoEnvio >= MINIMO_ENTRE_ENVIOS;
    const lejos =
      ultimoPunto !== null && distanciaAprox(ultimoPunto, { lat, lng }) > METROS_PARA_MANDAR;

    if (rato || lejos) mandar(lat, lng, accuracy);
  };

  const tic = () => {
    if (!navigator.onLine) return;
    if (!hayTrabajo()) return;
    if (Date.now() - ultimoEnvio < CADA_MS) return;
    ultimoEnvio = Date.now();
    void avisarPosicion();
  };

  tic();
  const timer = window.setInterval(tic, CADA_MS);

  /*
   * SEGUIMIENTO EN VIVO MIENTRAS LA APP ESTÁ EN PANTALLA.
   *
   * `watchPosition` avisa cada vez que el celular consigue una posición nueva,
   * que andando en moto es seguido. Es bastante mejor que preguntar cada dos
   * minutos: el reloj puede caer justo cuando está parado en un semáforo y
   * perderse las diez cuadras de después.
   *
   * Lo que NO cambia es el límite de siempre: con la app atrás, el navegador
   * también congela esto. Es seguimiento continuo mientras la usa, no continuo
   * de verdad. Para eso está la app de Android, más abajo; desde un navegador
   * —Chrome, o el Safari de un iPhone— esto sigue siendo todo lo que hay.
   *
   * Se sube como mucho una posición por minuto, o antes si se movió más de
   * 150 metros. Sin ese freno, andando se mandarían varias por minuto sin que
   * el mapa se vea distinto.
   */
  let watchId: number | null = null;

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!navigator.onLine || !hayTrabajo()) return;

        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        mandarSiVale(lat, lng, accuracy);
      },
      () => {
        // Sin permiso o sin señal de GPS: queda el reloj, que reintenta solo.
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  }

  /*
   * Y ACÁ EL SEGUIMIENTO DE VERDAD, el de la app de Android.
   *
   * Todo lo de arriba se apaga cuando la app queda atrás. Esto no: el GPS lo
   * maneja Android, no el navegador, así que sigue avisando con el celular en
   * el bolsillo o con el repartidor mirando Maps. Es la única parte del
   * sistema que la app hace distinto.
   *
   * Se deja arriba lo del navegador igual, sin sacar nada. Cubre el rato hasta
   * que el permiso está dado, y es lo único que existe para el que entre desde
   * Chrome o desde un iPhone. Los dos pasan por el mismo freno, así que tenerlos
   * juntos no manda una posición de más.
   */
  let cortarNativo: (() => void) | null = null;
  let sobra = false;

  void seguirEnviandoNativo(hayTrabajo, mandarSiVale).then((cortar) => {
    // Si el efecto se desarmó mientras se pedía el permiso, no dejamos el
    // seguimiento prendido: cortarlo acá es la única oportunidad que hay.
    if (sobra) cortar?.();
    else cortarNativo = cortar;
  });

  // Volver a la app es el momento más confiable que hay para tomar posición:
  // la pantalla está prendida y el GPS despierto.
  const alVolver = () => {
    if (document.visibilityState === 'visible') tic();
  };
  document.addEventListener('visibilitychange', alVolver);

  return () => {
    sobra = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', alVolver);
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    cortarNativo?.();
  };
}

/**
 * Manda una posición ahora mismo, salteando la espera del intervalo.
 *
 * Es lo que se llama al marcar "salgo en camino": sin esto, el que abre el
 * seguimiento en ese momento no ve nada hasta el próximo tic, y eso son varios
 * minutos mirando una pantalla que parece rota.
 */
export function avisarPosicionYa(): void {
  ultimoEnvio = Date.now();
  void avisarPosicion();
}

/**
 * Manda una posición si ya pasó el rato, aprovechando que la app está en uso.
 *
 * ES LO QUE HACE QUE EL MAPA SIRVA. El reloj de dos minutos no corre cuando la
 * pantalla está atrás —el celular lo congela— y el repartidor se pasa el día
 * en Maps y en WhatsApp. Los momentos en que la app SÍ está adelante son
 * pocos y conocidos: cuando vuelve, cuando escanea un paquete, cuando cierra
 * una entrega, cuando actualiza la hoja de ruta. Enganchándose a todos ellos,
 * la posición se refresca cada vez que toca algo, que en una jornada es
 * bastante más seguido que nunca.
 *
 * Respeta el mismo espaciado que el reloj: tocar cinco botones seguidos no
 * dispara cinco lecturas de GPS.
 */
export function avisarPosicionSiCorresponde(): void {
  if (typeof navigator === 'undefined' || !navigator.onLine) return;
  if (Date.now() - ultimoEnvio < CADA_MS) return;
  ultimoEnvio = Date.now();
  void avisarPosicion();
}
