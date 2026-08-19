'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { leerSesion, pantallaDe } from '@/lib/role';
import Logo from '@/components/Logo';

/** Los repartidores entran con usuario (juan.perez); por dentro es un mail. */
const DOMAIN = 'enviosdosruedas.local';
const toEmail = (value: string) => {
  const v = value.trim().toLowerCase();
  return v.includes('@') ? v : `${v}@${DOMAIN}`;
};

/**
 * De qué puerta viene el que está entrando.
 *
 * ES SÓLO UN CARTEL. No decide nada: quien entra va a donde diga su rol, venga
 * de donde venga, y por eso el admin puede usar cualquiera de las dos. Sirve
 * para que el que llega desde "Ingreso comercios" vea que llegó al lugar que
 * tocó, en vez de una pantalla igual para todos que no le confirma nada.
 *
 * No se usa para restringir a propósito: un cartel que promete un filtro que
 * no existe es peor que no tener cartel.
 */
const PUERTAS = {
  repartidor: {
    titulo: 'Ingreso repartidores',
    bajada: 'Entrá con tu usuario para ver tu hoja de ruta del día.',
    ejemplo: 'juan.perez',
  },
  comercio: {
    titulo: 'Ingreso comercios',
    bajada: 'Entrá con el usuario que te dimos para ver tus envíos.',
    ejemplo: 'tucomercio',
  },
} as const;

const NEUTRA = {
  titulo: 'Envíos DosRuedas',
  bajada: 'Entrá con tu usuario y contraseña.',
  ejemplo: 'juan.perez',
};

type Puerta = typeof NEUTRA;

export default function LoginPage() {
  /*
   * `useSearchParams` obliga a un Suspense alrededor. Mientras tanto se dibuja
   * el formulario neutro —que anda igual— así que nadie se queda mirando un
   * cartel de "cargando" para escribir un usuario.
   */
  return (
    <Suspense fallback={<Formulario puerta={NEUTRA} />}>
      <ConPuerta />
    </Suspense>
  );
}

function ConPuerta() {
  const como = useSearchParams().get('como');
  return <Formulario puerta={como === 'repartidor' || como === 'comercio' ? PUERTAS[como] : NEUTRA} />;
}

function Formulario({ puerta }: { puerta: Puerta }) {
  const router = useRouter();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verClave, setVerClave] = useState(false);

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
          {puerta.titulo}
        </h1>
        <p className="mb-6 text-sm text-[var(--edr-muted)]">{puerta.bajada}</p>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Usuario
        </label>
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          placeholder={puerta.ejemplo}
          className="mb-4 w-full rounded border border-[var(--edr-border)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]"
        />

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Contraseña
        </label>
        {/*
          El ojito para mirar lo que se escribe.

          Los puntitos existen para que no te espíen la pantalla, y en un
          celular al sol, con una contraseña que te pasaron por WhatsApp, lo
          único que hacen es que la escribas mal tres veces. Que cada uno
          decida: arranca tapada y se destapa si querés.
        */}
        <div className="relative mb-5">
          <input
            type={verClave ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
            className="w-full rounded border border-[var(--edr-border)] py-2 pl-3 pr-11 text-sm outline-none focus:border-[var(--edr-yellow)]"
          />
          <button
            type="button"
            onClick={() => setVerClave((v) => !v)}
            aria-label={verClave ? 'Ocultar la contraseña' : 'Ver la contraseña'}
            title={verClave ? 'Ocultar la contraseña' : 'Ver la contraseña'}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-[var(--edr-muted)] hover:text-[var(--edr-yellow)]"
          >
            {verClave ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

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
