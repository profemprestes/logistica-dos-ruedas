'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { leerSesion, pantallaDe } from '@/lib/role';
import Logo from '@/components/Logo';

/** Los repartidores entran con usuario (juan.perez); por dentro es un mail. */
const DOMAIN = 'enviosdosruedas.local';
const toEmail = (value: string) => {
  const v = value.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${DOMAIN}`;
};

export default function LoginPage() {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    setError('');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: toEmail(user),
      password,
    });

    if (authError) {
      setLoading(false);
      setError(
        /credentials/i.test(authError.message)
          ? 'Usuario o contraseña incorrectos.'
          : authError.message
      );
      return;
    }

    // Cada uno a su pantalla. Si el rol no se puede leer NO se asume nada: dar
    // por sentado "repartidor" es lo que le abría la app del repartidor al
    // admin cuando la consulta fallaba.
    const { rol } = await leerSesion();

    setLoading(false);

    if (!rol) {
      setError(
        'Entraste bien, pero no pudimos verificar tu cuenta. Revisá la conexión y probá de nuevo.'
      );
      return;
    }

    router.replace(pantallaDe(rol));
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-8">
        <Logo size={72} full className="mx-auto mb-4 h-auto w-20" />
        <h1 className="text-2xl font-black tracking-tight text-[var(--edr-yellow)]">
          Envíos DosRuedas
        </h1>
        <p className="mb-6 text-sm text-[var(--edr-muted)]">Entrá con tu usuario y contraseña.</p>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Usuario
        </label>
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="juan.perez"
          className="mb-4 w-full rounded border border-[var(--edr-border)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]"
        />

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Contraseña
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && login()}
          className="mb-5 w-full rounded border border-[var(--edr-border)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]"
        />

        {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

        <button
          onClick={login}
          disabled={loading}
          className="w-full rounded bg-[var(--edr-yellow)] py-2.5 text-sm font-black text-black hover:brightness-95 disabled:opacity-50"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </div>
    </div>
  );
}
