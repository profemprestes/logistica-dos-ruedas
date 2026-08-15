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

/**
 * Por qué no arrancó el seguimiento, si no arrancó.
 *
 * ESTO EXISTE POR UN ERROR QUE COSTÓ UNA TARDE. Todo este archivo estaba
 * escrito para fallar en silencio, con el argumento de que el repartidor no
 * tiene que ver errores rojos por el GPS. Suena bien y está mal: cuando el
 * servicio no arrancó, la app se veía perfecta, no mandaba una sola posición y
 * nadie tenía forma de saber por qué. Se perdieron horas adivinando entre el
 * permiso, la batería del fabricante y el plugin.
 *
 * Sigue sin interrumpir al repartidor. Pero queda anotado y se puede mirar.
 */
let ultimoFallo: string | null = null;

/** Qué pasó con el GPS nativo. `null` significa que anda, o que no aplica. */
export function falloDelGpsNativo(): string | null {
  return ultimoFallo;
}

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

    ultimoFallo = null;

    const id = await gps.addWatcher(
      {
        backgroundTitle: AVISO_TITULO,
        backgroundMessage: AVISO_TEXTO,
        requestPermissions: true,
        // Posiciones viejas no sirven para decir dónde está ahora.
        stale: false,

        /*
         * QUE AVISE SIEMPRE, aunque no se haya movido. El espaciado lo decide
         * `seguirEnviando`, no acá.
         *
         * Antes esto era 50 metros y parecía lo prolijo: parado no gasta. En la
         * práctica dejaba a la oficina sin saber nada. Mirando el mapa, "sin
         * señal hace 20 minutos" puede ser un repartidor almorzando o un
         * repartidor al que se le murió la app, y hay que actuar distinto en
         * cada caso. Con el filtro puesto, las dos cosas se ven iguales.
         *
         * Avisar siempre no gasta más batería, que es lo que uno supondría: el
         * GPS está prendido igual mientras el servicio corre, y el filtro sólo
         * decidía si nos enterábamos. Lo que se agrega es un pedido de red cada
         * tanto, que al lado del GPS no se nota.
         */
        distanceFilter: 0,
      },
      (posicion?: Location, error?: { code?: string }) => {
        /*
         * El error más común acá es que el repartidor no dio el permiso de
         * ubicación, y hasta hoy se descartaba en silencio: la app se veía
         * perfecta y no mandaba una sola posición. Queda anotado.
         */
        if (error) {
          ultimoFallo = error.code ?? 'el GPS devolvió un error sin código';
          return;
        }
        if (!posicion) return;
        if (!hayTrabajo()) return;

        mandar(posicion.latitude, posicion.longitude, posicion.accuracy);
      },
    );

    return () => {
      void gps.removeWatcher({ id });
    };
  } catch (err) {
    // El plugin no está, o el permiso quedó denegado. La app sirve igual: se
    // comporta como el navegador, que es como venía andando hasta ahora. Pero
    // eso no se adivina desde afuera, así que se anota.
    ultimoFallo = err instanceof Error ? err.message : 'no se pudo arrancar el GPS';
    return null;
  }
}

/**
 * Que el botón atrás de Android cierre el cuadro y no la app.
 *
 * CAPACITOR NO TOCA EL BOTÓN ATRÁS: Android cierra la actividad directamente y
 * el navegador de adentro nunca se entera. O sea que todo el trabajo de
 * `useCerrarConAtras` —que agrega un paso al historial y espera que se lo
 * saquen— no llegaba a correr nunca. Probado en la calle el 15/08/2026: abrir
 * el escáner, tocar atrás, y quedarse afuera de la app.
 *
 * Enganchándose acá, el atrás de Android pasa a ser un "atrás" del navegador y
 * a partir de ahí funciona lo que ya estaba escrito, sin tocarlo. Por eso el
 * arreglo va de este lado y no en `useAtras`: en un navegador ese código anda
 * bien, y el que entre desde un iPhone no tiene por qué cargar con esto.
 *
 * Y CUANDO NO HAY NADA ATRÁS la app se manda al fondo en vez de cerrarse. Es lo
 * que hace cualquier app de Android, y acá importa más que en otras: cerrarla
 * corta el seguimiento de la jornada.
 */
export async function manejarAtrasNativo(): Promise<void> {
  if (!(await esAppNativa())) return;

  try {
    const { App } = await import('@capacitor/app');

    void App.addListener('backButton', ({ canGoBack }) => {
      // El paso del cuadro abierto está arriba de todo en el historial:
      // retroceder lo saca y `useCerrarConAtras` cierra el cuadro.
      if (window.history.state?.edrCuadro === true || canGoBack) {
        window.history.back();
        return;
      }

      void App.minimizeApp();
    });
  } catch (err) {
    console.error('[nativo] no se pudo enganchar el botón atrás', err);
  }
}
