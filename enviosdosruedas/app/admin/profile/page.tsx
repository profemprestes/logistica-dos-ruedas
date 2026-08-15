'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';

/**
 * Mi cuenta: los datos del admin y el cambio de su propia contraseña.
 *
 * A diferencia del perfil del repartidor, acá se pide la contraseña actual.
 * Es la cuenta que maneja envíos, caja y stock: si alguien se sienta en la
 * computadora con la sesión abierta, no tiene que poder dejarte afuera.
 */

const field =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--edr-yellow)] focus:ring-2 focus:ring-[var(--edr-yellow)]/10';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';
const card = 'rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-5';
const btnPrimary =
  'rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-black hover:brightness-95 disabled:opacity-50';

interface Cuenta {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  role: string;
}

/** Consulta suelta, sin estado adentro: se puede disparar desde un efecto. */
async function fetchCuenta(): Promise<Cuenta | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return null;

  const { data: perfil } = await supabase
    .from('profiles')
    .select('full_name, phone, role')
    .eq('id', user.id)
    .maybeSingle();

  return {
    id: user.id,
    email: user.email ?? '',
    full_name: perfil?.full_name ?? '',
    phone: perfil?.phone ?? '',
    role: perfil?.role ?? '',
  };
}

export default function AdminProfilePage() {
  const router = useRouter();
  /** Sólo admin: acá se cambia la contraseña de la cuenta que maneja todo. */
  const esAdmin = useAdminGuard();
  const [cuenta, setCuenta] = useState<Cuenta | null>(null);
  const [cargando, setCargando] = useState(true);

  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [guardandoDatos, setGuardandoDatos] = useState(false);

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const [guardandoClave, setGuardandoClave] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const aplicar = useCallback(
    (c: Cuenta | null) => {
      if (!c) {
        router.replace('/login');
        return;
      }
      setCuenta(c);
      setNombre(c.full_name);
      setTelefono(c.phone);
      setCargando(false);
    },
    [router]
  );

  useEffect(() => {
    if (!esAdmin) return;
    let cancelled = false;
    fetchCuenta()
      .then((c) => !cancelled && aplicar(c))
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar tu cuenta.');
        setCargando(false);
      });
    return () => {
      cancelled = true;
    };
  }, [esAdmin, aplicar]);

  const avisar = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 6000);
  };

  /**
   * Va por la ruta de servidor en vez de escribir `profiles` directo: es la
   * misma que usa el alta de repartidores, ya comprobada, y no depende de que
   * exista una política de RLS que deje a cada uno editarse a sí mismo.
   */
  async function guardarDatos() {
    if (!cuenta) return;
    setGuardandoDatos(true);
    setError('');

    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/drivers', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({
          id: cuenta.id,
          full_name: nombre.trim(),
          phone: telefono.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudieron guardar los datos.');

      setCuenta({ ...cuenta, full_name: nombre.trim(), phone: telefono.trim() });
      avisar('Datos actualizados.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron guardar los datos.');
    }
    setGuardandoDatos(false);
  }

  async function cambiarClave() {
    if (!cuenta) return;
    if (!actual) return setError('Escribí tu contraseña actual.');
    if (nueva.length < 8) return setError('La contraseña nueva tiene que tener 8 caracteres o más.');
    if (nueva !== repetir) return setError('Las dos contraseñas nuevas no coinciden.');
    if (nueva === actual) return setError('La contraseña nueva tiene que ser distinta de la actual.');

    setGuardandoClave(true);
    setError('');

    // Supabase deja cambiar la clave sin pedir la vieja. La comprobamos a mano
    // volviendo a entrar con ella: si no coincide, no seguimos. Como es el
    // mismo usuario, la sesión abierta no se pierde.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: cuenta.email,
      password: actual,
    });

    if (authError) {
      setGuardandoClave(false);
      return setError(
        /credentials/i.test(authError.message)
          ? 'La contraseña actual no coincide.'
          : authError.message
      );
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: nueva });
    setGuardandoClave(false);

    if (updateError) return setError(updateError.message);

    setActual('');
    setNueva('');
    setRepetir('');
    avisar('Listo, contraseña cambiada. La próxima vez que entres, usá la nueva.');
  }

  if (cargando) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  /** El usuario con el que entra es la parte de adelante del mail interno. */
  const usuario = cuenta?.email.split('@')[0] ?? '';

  return (
    <div className="min-h-screen">

      <main className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="mb-1 text-xl font-black">Mi cuenta</h1>
        <p className="mb-5 text-xs text-[var(--edr-muted)]">
          Entrás con el usuario <span className="edr-mono">{usuario}</span>
          {cuenta?.role === 'admin' && ' · Administrador'}
        </p>

        {notice && (
          <div className="mb-4 rounded border border-emerald-400 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* Datos ----------------------------------------------------- */}
        <section className={`${card} mb-6`}>
          <h2 className="mb-4 text-base font-bold">Mis datos</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Nombre y apellido</label>
              <input className={field} value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input
                className={field}
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </div>
          </div>

          <button onClick={guardarDatos} disabled={guardandoDatos} className={`${btnPrimary} mt-4`}>
            {guardandoDatos ? 'Guardando…' : 'Guardar datos'}
          </button>
        </section>

        {/* Contraseña ------------------------------------------------ */}
        <section className={card}>
          <h2 className="mb-1 text-base font-bold">Cambiar mi contraseña</h2>
          <p className="mb-4 text-xs text-[var(--edr-muted)]">
            Hace falta la actual. El usuario no cambia: seguís entrando como{' '}
            <span className="edr-mono">{usuario}</span>.
          </p>

          <div className="grid gap-3">
            <div>
              <label className={labelCls}>Contraseña actual</label>
              <input
                className={field}
                type="password"
                autoComplete="current-password"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Contraseña nueva</label>
                <input
                  className={field}
                  type="password"
                  autoComplete="new-password"
                  placeholder="mínimo 8 caracteres"
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Repetila</label>
                <input
                  className={field}
                  type="password"
                  autoComplete="new-password"
                  value={repetir}
                  onChange={(e) => setRepetir(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && cambiarClave()}
                />
              </div>
            </div>
          </div>

          <button onClick={cambiarClave} disabled={guardandoClave} className={`${btnPrimary} mt-4`}>
            {guardandoClave ? 'Guardando…' : 'Guardar contraseña'}
          </button>

          <p className="mt-3 text-xs text-[var(--edr-muted)]">
            Si la perdés no hay forma de recuperarla desde acá: se cambia desde Supabase, en
            Authentication → Users.
          </p>
        </section>
      </main>
    </div>
  );
}
