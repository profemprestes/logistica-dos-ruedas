'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';

/**
 * Puerta de entrada. El layout ya pidió cámara y GPS antes de montar esto,
 * así que acá sólo queda ver si hay sesión y mandarlo a la hoja de ruta.
 */
export default function DriverEntryPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      router.replace(data.session ? '/driver/dashboard' : '/login');
    });
  }, [router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--edr-border)] border-t-[var(--edr-yellow)]" />
      <p className="text-lg font-bold">Entrando…</p>
    </div>
  );
}
