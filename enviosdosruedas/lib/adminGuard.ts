'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { leerSesion, pantallaDe } from '@/lib/role';

/**
 * Deja entrar al panel SÓLO si sos admin.
 *
 * Las pantallas de /admin preguntaban únicamente "¿hay sesión?". Con eso, un
 * repartidor o un comercio logueado que escribiera la dirección a mano entraba
 * al panel, y el comprobante de entrega tiene DNI y dirección del destinatario.
 *
 * ¡OJO con el caso "no sé"! La primera versión mandaba a /driver cuando no
 * podía leer el rol, y eso echaba al admin a la app del repartidor por una
 * consulta fallida. Ahora sólo se manda a otra pantalla cuando SABEMOS qué es;
 * si no se pudo averiguar, vuelve al login, que es honesto y no miente sobre quien sos.
 */
export function useAdminGuard(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const aplicar = useCallback(
    (s: Awaited<ReturnType<typeof leerSesion>>) => {
      if (!s.logueado) return router.replace('/login');
      if (s.rol === 'admin') return setReady(true);
      // Sólo se lo deriva cuando el rol se pudo leer de verdad.
      if (s.rol) return router.replace(pantallaDe(s.rol));
      router.replace('/login');
    },
    [router],
  );

  useEffect(() => {
    let cancelled = false;
    leerSesion()
      .then((s) => !cancelled && aplicar(s))
      .catch(() => !cancelled && router.replace('/login?motivo=rol'));
    return () => {
      cancelled = true;
    };
  }, [aplicar, router]);

  return ready;
}
