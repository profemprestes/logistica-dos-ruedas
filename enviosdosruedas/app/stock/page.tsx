'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/**
 * Acá vivía la pantalla de stock del comercio (paso 13). Con el paso 56 el
 * stock del comercio se ve adentro de su portal, junto a sus envíos: una sola
 * puerta en vez de dos pantallas con dos sesiones.
 *
 * La dirección se mantiene como redirección porque puede estar guardada en
 * favoritos o pasada por WhatsApp: un link viejo que muere en un 404 es una
 * llamada a la oficina.
 */
export default function StockRedirect() {
  const router = useRouter();

  useEffect(() => {
    let vivo = true;

    const decidir = async () => {
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      if (!data.session) return router.replace('/login');

      const { data: perfil } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', data.session.user.id)
        .maybeSingle();
      if (!vivo) return;

      router.replace(perfil?.role === 'admin' ? '/admin/stock' : '/comercio');
    };

    void decidir();
    return () => {
      vivo = false;
    };
  }, [router]);

  return <div className="p-8 text-sm text-[var(--edr-muted)]">Un momento…</div>;
}
