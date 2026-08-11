'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/**
 * Deja entrar al panel SÓLO si sos admin.
 *
 * Antes las pantallas de /admin preguntaban únicamente "¿hay sesión?". Con eso,
 * un repartidor o un comercio logueado que escribiera la dirección a mano
 * entraba al panel: lo que veía dependía nada más que del RLS de cada tabla, y
 * el comprobante de entrega tiene DNI y dirección del destinatario.
 *
 * El candado de los datos siempre es el de la base. Esto es la puerta de la
 * casa: que nadie que no tenga por qué se pare adentro a probar picaportes.
 */

/** Consulta suelta, sin estado adentro: devuelve a dónde mandarlo, o null si puede pasar. */
async function destinoSegunRol(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return '/login';

  const { data: perfil } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.session.user.id)
    .maybeSingle();

  if (perfil?.role === 'admin') return null;
  if (perfil?.role === 'comercio') return '/stock';
  return '/driver';
}

/** `true` cuando ya se confirmó que quien mira es admin. */
export function useAdminGuard(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const aplicar = useCallback(
    (destino: string | null) => {
      if (destino) router.replace(destino);
      else setReady(true);
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    destinoSegunRol()
      .then((d) => !cancelled && aplicar(d))
      // Sin red no podemos comprobar el rol: por las dudas, afuera.
      .catch(() => !cancelled && aplicar('/login'));
    return () => {
      cancelled = true;
    };
  }, [aplicar]);

  return ready;
}
