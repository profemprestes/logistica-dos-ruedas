import { supabase } from '@/lib/supabaseClient';

/**
 * Avisa al repartidor por notificación push.
 *
 * Nunca tira error hacia arriba: si el aviso falla, la acción que lo disparó
 * (asignar un envío, cerrar la caja) ya se hizo y no se puede deshacer por esto.
 * Queda anotado en la consola para poder revisarlo.
 */
export async function notificarRepartidor(opciones: {
  driverId: string;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
      body: JSON.stringify(opciones),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) console.error('[notify] el servidor rechazó el aviso', json);
    else if (json.sinSuscripcion)
      console.info('[notify] el repartidor todavía no activó las notificaciones.');
  } catch (err) {
    console.error('[notify] no se pudo avisar', err);
  }
}
