'use client';

/**
 * Las notificaciones adentro de la app de Android.
 *
 * El camino de siempre (`lib/driver/push.ts`) no sirve acá: la ventana de una
 * app de Android NO TIENE Web Push. No es que ande mal, no está implementado.
 * `'PushManager' in window` da false y la app se queda muda para siempre sin
 * decir por qué.
 *
 * Android usa Firebase: en vez de una URL con claves de cifrado entrega un
 * token —un texto solo— y el servidor le manda los avisos ahí. Se guarda en
 * `push_tokens` (paso 35), separado de las suscripciones del navegador.
 *
 * Todo lo de acá se saltea solo si no estamos adentro del APK.
 */
import { supabase } from '@/lib/supabaseClient';
import { esAppNativa } from '@/lib/driver/nativo';
import type { EstadoPush } from '@/lib/driver/push';

/**
 * Cuánto se espera el token de Firebase.
 *
 * `register()` contesta al toque pero el token llega después, por un aviso
 * aparte, y puede tardar si el celular está renovándolo contra Google. Sin este
 * tope, activar los avisos se quedaría girando para siempre con mala señal.
 */
const ESPERA_TOKEN_MS = 15_000;

/** Para saber de qué celular es cada fila cuando haya que revisar la tabla. */
function comoSeLlamaEsteCelular(): string {
  if (typeof navigator === 'undefined') return 'Android';
  const m = navigator.userAgent.match(/Android[^;)]*;\s*([^;)]+)/);
  return (m?.[1] ?? 'Android').trim().slice(0, 100);
}

/**
 * Pide permiso y consigue el token. Devuelve null si el repartidor dijo que no.
 *
 * El token no vuelve del `register()`: llega por el aviso 'registration', que
 * es como funciona Firebase. Por eso la promesa se arma a mano.
 */
async function conseguirToken(): Promise<string | null> {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  let permiso = await PushNotifications.checkPermissions();
  if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
    permiso = await PushNotifications.requestPermissions();
  }
  if (permiso.receive !== 'granted') return null;

  return new Promise<string | null>((resolve) => {
    let listo = false;
    const terminar = (token: string | null) => {
      if (listo) return;
      listo = true;
      resolve(token);
    };

    void PushNotifications.addListener('registration', (t) => terminar(t.value));
    void PushNotifications.addListener('registrationError', () => terminar(null));

    void PushNotifications.register();
    setTimeout(() => terminar(null), ESPERA_TOKEN_MS);
  });
}

/** ¿Este celular ya está dado de alta? */
export async function estadoPushNativo(): Promise<EstadoPush | null> {
  if (!(await esAppNativa())) return null;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const permiso = await PushNotifications.checkPermissions();

    if (permiso.receive === 'denied') return 'bloqueado';
    if (permiso.receive !== 'granted') return 'sin-permiso';

    /*
     * Con el permiso dado todavía puede faltar la fila: se reinstaló la app y
     * Firebase entregó un token nuevo, o alguien borró la fila a mano. Se
     * pregunta a la base y no al celular, porque lo que decide si el aviso
     * llega es que el servidor lo tenga guardado.
     */
    const { data } = await supabase.auth.getUser();
    if (!data.user) return 'sin-permiso';

    const { count } = await supabase
      .from('push_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('driver_id', data.user.id);

    return (count ?? 0) > 0 ? 'activo' : 'sin-permiso';
  } catch {
    return 'no-soportado';
  }
}

/** Alta: pide permiso, consigue el token y lo guarda. */
export async function activarPushNativo(driverId: string): Promise<EstadoPush | null> {
  if (!(await esAppNativa())) return null;

  try {
    const token = await conseguirToken();
    if (!token) {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const permiso = await PushNotifications.checkPermissions();
      return permiso.receive === 'denied' ? 'bloqueado' : 'sin-permiso';
    }

    // `token` es único: si este celular ya estaba, se actualiza en vez de
    // duplicarse. Igual que el `endpoint` del navegador en el paso 10.
    const { error } = await supabase.from('push_tokens').upsert(
      { driver_id: driverId, token, device: comoSeLlamaEsteCelular() },
      { onConflict: 'token' },
    );

    if (error) {
      console.error('[push nativo] no se pudo guardar el token', error);
      return 'sin-permiso';
    }

    return 'activo';
  } catch (err) {
    console.error('[push nativo] falló el alta', err);
    return 'no-soportado';
  }
}

/** Baja: deja de recibir en ESTE celular. */
export async function desactivarPushNativo(): Promise<EstadoPush | null> {
  if (!(await esAppNativa())) return null;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { data } = await supabase.auth.getUser();

    if (data.user) {
      // Se borran las de este repartidor y listo. Guardar el token para
      // borrar sólo el de este celular sería más fino, pero un repartidor con
      // dos celulares es un caso que no existe acá, y equivocarse para el otro
      // lado —dejar avisos prendidos en un celular que devolvió— es peor.
      await supabase.from('push_tokens').delete().eq('driver_id', data.user.id);
    }

    await PushNotifications.unregister();
    return 'sin-permiso';
  } catch {
    return 'sin-permiso';
  }
}

/**
 * Vuelve a anotar el token en cada arranque, si el permiso ya está dado.
 *
 * REINSTALAR LA APP MATA LAS NOTIFICACIONES EN SILENCIO, y así fue como nos
 * enteramos: se reinstaló el APK, Android le dio un token nuevo a esa
 * instalación, el guardado quedó muerto, y al asignar un envío no llegó nada.
 * Ni el repartidor ni la oficina tenían forma de saberlo — todo se veía bien,
 * simplemente no sonaba.
 *
 * Lo mismo pasa sin reinstalar: Firebase rota los tokens por su cuenta cada
 * tanto. O sea que no era un caso raro de una vez, era una bomba de tiempo.
 *
 * Anotarlo de nuevo en cada arranque lo resuelve para siempre y no cuesta
 * nada: si el token es el mismo, la fila se pisa con ella misma.
 *
 * NO PIDE PERMISO. Si el repartidor nunca lo dio, o dijo que no, acá no pasa
 * nada: eso se decide en Perfil, con un botón y a propósito.
 */
export async function refrescarTokenNativo(): Promise<void> {
  if (!(await esAppNativa())) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const permiso = await PushNotifications.checkPermissions();
    if (permiso.receive !== 'granted') return;

    const { data } = await supabase.auth.getUser();
    if (!data.user) return;

    const token = await conseguirToken();
    if (!token) return;

    await supabase
      .from('push_tokens')
      .upsert(
        { driver_id: data.user.id, token, device: comoSeLlamaEsteCelular() },
        { onConflict: 'token' },
      );
  } catch {
    // Que no se pueda refrescar no rompe nada de lo que el repartidor está
    // por hacer. Se reintenta solo la próxima vez que abra la app.
  }
}

/**
 * Qué pasa cuando llega un aviso. Se engancha una sola vez, al abrir la app.
 *
 * DOS CASOS DISTINTOS, y por eso hay dos escuchas:
 *
 *  - Con la app cerrada o atrás, la notificación la dibuja Android solo, sin
 *    pasar por acá. Es lo que hace que el aviso llegue con la app cerrada, que
 *    es todo el punto.
 *  - Con la app ABIERTA, Android no muestra nada: asume que el usuario ya está
 *    mirando. Pero el repartidor puede tener la app abierta en otra pantalla,
 *    así que el aviso lo dibujamos nosotros.
 */
export async function escucharAvisosNativos(): Promise<void> {
  if (!(await esAppNativa())) return;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const { LocalNotifications } = await import('@capacitor/local-notifications');

    void PushNotifications.addListener('pushNotificationReceived', (aviso) => {
      void LocalNotifications.schedule({
        notifications: [
          {
            id: Date.now() % 2_147_483_647,
            title: aviso.title ?? 'Envíos DosRuedas',
            body: aviso.body ?? '',
            extra: aviso.data,
          },
        ],
      });
    });

    // Tocar el aviso tiene que llevar a donde dice el aviso, no a la pantalla
    // en la que quedó la app la última vez.
    void PushNotifications.addListener('pushNotificationActionPerformed', (accion) => {
      const destino = (accion.notification.data as { url?: string } | undefined)?.url;
      if (destino && typeof window !== 'undefined') window.location.href = destino;
    });
  } catch (err) {
    console.error('[push nativo] no se pudieron enganchar los avisos', err);
  }
}
