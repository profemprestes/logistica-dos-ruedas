/**
 * Lo único que la app de Android hace y el navegador no puede.
 *
 * El resto del sistema es idéntico en los dos lados: el APK abre el mismo
 * sitio. La diferencia es esta: acá el GPS lo maneja Android y no el
 * navegador, así que sigue mandando la posición con la app atrás, en Maps o
 * con la pantalla apagada. Es el motivo entero por el que existe la app.
 *
 * TODO ESTE ARCHIVO NO HACE NADA EN UN NAVEGADOR. Cada función pregunta
 * primero si está adentro del APK y si no, se va sin tocar nada. Un repartidor
 * con iPhone, o cualquiera que entre desde Chrome, sigue funcionando exacto
 * como hasta ahora.
 *
 * Las reglas de siempre no cambian, porque no viven acá: `registrar_posicion`
 * (paso 25) sigue siendo la que decide si guarda o no, y sigue guardando sólo
 * mientras haya trabajo del día sin cerrar. La app nueva llama a la misma
 * función. Si mañana se cambia la regla en la base, cambia para los dos lados.
 */
import type { BackgroundGeolocationPlugin, Location } from '@capacitor-community/background-geolocation';

/** Se resuelve una sola vez: preguntar en cada punto no tiene sentido. */
let nativo: boolean | null = null;

/** ¿Estamos adentro del APK? */
export async function esAppNativa(): Promise<boolean> {
  if (nativo !== null) return nativo;
  if (typeof window === 'undefined') return false;

  try {
    const { Capacitor } = await import('@capacitor/core');
    nativo = Capacitor.isNativePlatform();
  } catch {
    // Ni siquiera está el paquete: navegador común.
    nativo = false;
  }
  return nativo;
}

/**
 * Manda la posición SIN pasar por el navegador.
 *
 * Y esto no es una elección de estilo. Después de cinco minutos con la app
 * atrás, Android estrangula las llamadas de red que salen del navegador de
 * adentro de la app: el GPS sigue avisando y los envíos se pierden en silencio.
 * O sea, justo en el rato largo que queremos cubrir. La salida es que el pedido
 * lo haga Android, que no está estrangulado.
 *
 * (Está documentado por el propio plugin. Se probó y se dio vuelta más de una
 * vez en proyectos ajenos; no vale la pena volver a comprobarlo a mano.)
 *
 * Devuelve `null` si no es la app nativa, para que quien llama siga por el
 * camino de siempre.
 */
export async function mandarPosicionNativa(
  lat: number,
  lng: number,
  accuracy: number | null,
): Promise<boolean | null> {
  if (!(await esAppNativa())) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;

  try {
    const { CapacitorHttp } = await import('@capacitor/core');
    const { supabase } = await import('@/lib/supabaseClient');

    /*
     * El token se lee de la sesión que ya maneja supabase-js. A propósito no lo
     * renovamos por nuestra cuenta: Supabase invalida el token de refresco al
     * usarlo, así que hacerlo por atrás dejaría al repartidor deslogueado en
     * medio del reparto. Si venció y no se pudo renovar, se pierde ese punto y
     * se recupera solo cuando vuelve a abrir la app.
     */
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;

    const res = await CapacitorHttp.post({
      url: `${url}/rest/v1/rpc/registrar_posicion`,
      headers: {
        apikey: anon,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      data: { p_lat: lat, p_lng: lng, p_accuracy_m: accuracy },
    });

    return res.status >= 200 && res.status < 300;
  } catch {
    // Sin señal, o el pedido no salió. Se pierde el punto y ya está: el
    // repartidor no tiene que enterarse de esto.
    return false;
  }
}

/** Lo que se le pasa a Android para el aviso fijo que obliga a mostrar. */
const AVISO_TITULO = 'Envíos DosRuedas';
const AVISO_TEXTO = 'Compartiendo tu ubicación mientras tengas envíos del día sin cerrar.';

/**
 * Arranca el seguimiento nativo. Devuelve cómo cortarlo, o null si no aplica.
 *
 * ANDROID OBLIGA A AVISAR, y está bien que obligue: mientras esto corre, el
 * repartidor ve una notificación fija que no se puede sacar, diciendo que la
 * app está usando su ubicación. No es un rastreo escondido y no queremos que
 * lo sea.
 *
 * No se pide el permiso de "ubicación todo el tiempo", que es el que Android
 * marca en rojo. Alcanza con el permiso normal más el aviso fijo: mientras el
 * aviso está en pantalla, Android deja seguir tomando posiciones aunque la app
 * esté atrás.
 */
export async function seguirEnviandoNativo(
  hayTrabajo: () => boolean,
  mandar: (lat: number, lng: number, accuracy: number) => void,
): Promise<(() => void) | null> {
  if (!(await esAppNativa())) return null;

  try {
    const { registerPlugin } = await import('@capacitor/core');
    const gps = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

    /*
     * El permiso de notificaciones va antes y aparte. Desde Android 13 el aviso
     * fijo no se muestra sin él; el seguimiento igual funciona, pero quedaría
     * corriendo sin que el repartidor lo vea, que es exactamente lo que no
     * queremos.
     */
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const estado = await LocalNotifications.checkPermissions();
      if (estado.display !== 'granted') await LocalNotifications.requestPermissions();
    } catch {
      // Si falla, seguimos igual: el GPS no depende de esto.
    }

    const id = await gps.addWatcher(
      {
        backgroundTitle: AVISO_TITULO,
        backgroundMessage: AVISO_TEXTO,
        requestPermissions: true,
        // Posiciones viejas no sirven para decir dónde está ahora.
        stale: false,
        // Andando, avisa cada 50 metros. Parado en un semáforo o almorzando no
        // manda nada, que es justo lo que ahorra batería.
        distanceFilter: 50,
      },
      (posicion?: Location, error?: { code?: string }) => {
        if (error) return;
        if (!posicion) return;
        if (!hayTrabajo()) return;

        mandar(posicion.latitude, posicion.longitude, posicion.accuracy);
      },
    );

    return () => {
      void gps.removeWatcher({ id });
    };
  } catch {
    // El plugin no está o el permiso quedó denegado. La app sirve igual: se
    // comporta como el navegador, que es como venía andando hasta ahora.
    return null;
  }
}
