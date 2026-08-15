'use client';

/**
 * Alta y baja de las notificaciones push del repartidor.
 *
 * El navegador entrega una "suscripción" (una URL única del servicio de push de
 * Google/Apple más dos claves de cifrado). Eso se guarda en Supabase: es la
 * única forma que tiene el servidor de avisarle algo al celular.
 *
 * OJO en iPhone: sólo funciona si la app está instalada en la pantalla de
 * inicio (iOS 16.4 o más nuevo). En el navegador suelto, Apple no lo permite.
 *
 * Y OJO ADENTRO DE LA APP DE ANDROID: nada de esto existe ahí. Una ventana de
 * app no tiene Web Push, así que `soportaPush()` daría false y el repartidor se
 * quedaría sin avisos sin enterarse. Por eso las tres funciones de abajo
 * preguntan primero si estamos adentro del APK y se van por el otro camino,
 * el de Firebase, que vive en `lib/driver/pushNativo.ts`.
 */
import { supabase } from '@/lib/supabaseClient';
import {
  activarPushNativo,
  desactivarPushNativo,
  estadoPushNativo,
} from '@/lib/driver/pushNativo';

export type EstadoPush = 'no-soportado' | 'sin-permiso' | 'activo' | 'bloqueado';

/** La clave pública viaja en base64url y el navegador la pide como bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normal);
  const salida = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) salida[i] = raw.charCodeAt(i);
  return salida;
}

export function soportaPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function estadoPush(): Promise<EstadoPush> {
  const nativo = await estadoPushNativo();
  if (nativo !== null) return nativo;

  if (!soportaPush()) return 'no-soportado';
  if (Notification.permission === 'denied') return 'bloqueado';

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? 'activo' : 'sin-permiso';
}

/**
 * Pide permiso, se suscribe y guarda la suscripción.
 * Tiene que llamarse desde un toque del usuario: los navegadores no dejan
 * pedir permiso de notificaciones sin un gesto de por medio.
 */
export async function activarPush(driverId: string): Promise<EstadoPush> {
  const nativo = await activarPushNativo(driverId);
  if (nativo !== null) return nativo;

  if (!soportaPush()) return 'no-soportado';

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return permiso === 'denied' ? 'bloqueado' : 'sin-permiso';

  const clave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!clave) {
    console.error('[push] falta NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    return 'no-soportado';
  }

  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(clave),
    }));

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
  if (!json.endpoint || !json.keys) return 'sin-permiso';

  // `endpoint` es único: si el celular ya estaba dado de alta, se actualiza.
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      driver_id: driverId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 300),
    },
    { onConflict: 'endpoint' },
  );

  if (error) {
    console.error('[push] no se pudo guardar la suscripción', error);
    return 'sin-permiso';
  }

  return 'activo';
}

/** Baja: deja de recibir en ESTE celular. */
export async function desactivarPush(): Promise<EstadoPush> {
  const nativo = await desactivarPushNativo();
  if (nativo !== null) return nativo;

  if (!soportaPush()) return 'no-soportado';

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'sin-permiso';

  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
  return 'sin-permiso';
}
