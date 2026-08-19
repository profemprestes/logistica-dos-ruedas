import { supabase } from '@/lib/supabaseClient';

/**
 * Qué es el que está mirando.
 *
 * `null` significa NO SÉ (no hay red, el token se está renovando, la consulta
 * falló), y es distinto de "no es admin". Esa diferencia importa: tratar un
 * "no sé" como "es repartidor" fue lo que mandaba al admin a la app del
 * repartidor cuando volvía a entrar desde el celular.
 */
export type Rol = 'admin' | 'repartidor' | 'comercio';

export interface Sesion {
  /** Hay sesión guardada en este dispositivo. */
  logueado: boolean;
  /** El rol, o null si no se pudo averiguar. */
  rol: Rol | null;
}

/**
 * Una sola consulta, con un reintento.
 *
 * El reintento no es por prolijidad: al volver a abrir la app el token puede
 * estar venciéndose y la primera consulta vuelve vacía por RLS. Un segundo
 * intento, ya con el token renovado, contesta bien.
 */
export async function leerSesion(): Promise<Sesion> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { logueado: false, rol: null };

  const id = data.session.user.id;

  for (let intento = 0; intento < 2; intento++) {
    const { data: perfil, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', id)
      .maybeSingle();

    if (!error && perfil?.role) return { logueado: true, rol: perfil.role as Rol };

    // Antes de reintentar, forzamos la renovación del token: si el problema
    // era ese, el segundo intento pasa.
    if (intento === 0) await supabase.auth.refreshSession();
  }

  return { logueado: true, rol: null };
}

/**
 * A dónde va cada uno al entrar.
 *
 * El comercio va a sus ENVÍOS y no a su stock. Antes iba al stock porque era
 * lo único que había para él; hoy lo que un comercio viene a mirar cien veces
 * por semana es dónde está su paquete, y el stock lo usan dos. Desde el portal
 * de envíos hay link al stock para el que lo tenga.
 */
export function pantallaDe(rol: Rol): string {
  if (rol === 'admin') return '/admin';
  if (rol === 'comercio') return '/comercio';
  return '/driver';
}
