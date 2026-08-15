'use client';

import { useEffect, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/driver/Toast';
import {
  activarPush,
  desactivarPush,
  estadoPush,
  type EstadoPush,
} from '@/lib/driver/push';
import { useOnline } from '@/lib/driver/useOnline';

const inputCls =
  'w-full rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-4 text-lg outline-none focus:border-[var(--edr-yellow)]';
const labelCls = 'mb-1 block text-sm font-bold uppercase tracking-wide text-[var(--edr-muted)]';


export default function DriverProfilePage() {
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  const [driver, setDriver] = useState<{ id: string; name: string; email: string } | null>(null);
  /** Envío que se está reabriendo para marcarlo como entregado. */
  /** Se incrementa para forzar que el resumen se vuelva a pedir. */
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [pushOcupado, setPushOcupado] = useState(false);

  const [abrirClave, setAbrirClave] = useState(false);
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [saving, setSaving] = useState(false);

  // --- sesión ------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace('/login');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();

      setDriver({ id: user.id, name: profile?.full_name ?? '', email: user.email ?? '' });
    });
  }, [router]);


  // Estado de las notificaciones de ESTE celular.
  useEffect(() => {
    let cancelado = false;
    estadoPush().then((e) => {
      if (!cancelado) setPush(e);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  async function alternarPush() {
    if (!driver) return;
    setPushOcupado(true);
    try {
      const nuevo = push === 'activo' ? await desactivarPush() : await activarPush(driver.id);
      setPush(nuevo);
      if (nuevo === 'activo') toast('Listo, vas a recibir avisos en este celular.', 'ok');
      else if (nuevo === 'bloqueado')
        toast('Bloqueaste las notificaciones. Habilitalas en los permisos del sitio.', 'error');
    } finally {
      setPushOcupado(false);
    }
  }

  // --- contraseña --------------------------------------------------------
  async function changePassword() {
    if (pass1.length < 8) return toast('La contraseña nueva tiene que tener 8 o más.', 'error');
    if (pass1 !== pass2) return toast('Las dos contraseñas no coinciden.', 'error');
    if (!online) return toast('Para cambiar la contraseña hace falta internet.', 'error');

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pass1 });
    setSaving(false);

    if (error) {
      console.error('[perfil] updateUser falló', error);
      toast(error.message, 'error');
      return;
    }

    setPass1('');
    setPass2('');
    setAbrirClave(false);
    toast('Listo, contraseña cambiada.', 'ok');
  }

  return (
    <div className="min-h-dvh pb-10">
      <header className="flex items-center justify-between bg-[var(--edr-surface-2)] px-4 py-3 text-white">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-black leading-tight">{driver?.name || 'Mi perfil'}</h1>
          <p className="truncate text-xs opacity-75">{driver?.email}</p>
        </div>
        <Link
          href="/driver/dashboard"
          className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-sm font-bold"
        >
          Hoja de ruta
        </Link>
      </header>

      <main className="space-y-5 px-4 py-4">
        {/* ---------- Período ---------- */}
        {/* La caja del día se mudó a su propia pantalla: es lo que el
            repartidor mira todos los días antes de pasar por la oficina, y
            acá quedaba abajo de todo, mezclada con la contraseña. */}
        <Link
          href="/driver/caja"
          className="flex min-h-16 items-center justify-between gap-3 rounded-3xl bg-[var(--edr-yellow)] px-5 text-[var(--edr-blue)] shadow-[var(--edr-sombra)] transition active:scale-95"
        >
          <span className="font-bebas text-xl tracking-[.08em]">VER MI CAJA DEL DÍA</span>
          <ChevronRight size={22} strokeWidth={2.5} />
        </Link>


        {/* ---------- Notificaciones ---------- */}
        <section className="rounded-2xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <h2 className="text-lg font-black">Notificaciones</h2>
          <p className="mt-1 text-sm text-[var(--edr-muted)]">
            Te avisamos cuando la oficina te asigna un envío a mano y cuando te cierran la caja
            del día.
          </p>

          {push === 'no-soportado' ? (
            <p className="mt-3 rounded-lg border border-[var(--edr-border)] px-3 py-2 text-sm">
              Este navegador no soporta notificaciones. En iPhone hay que instalar la app en la
              pantalla de inicio primero.
            </p>
          ) : push === 'bloqueado' ? (
            <p className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">
              Están bloqueadas. Tocá el candado al lado de la dirección → Permisos del sitio →
              Notificaciones → Permitir.
            </p>
          ) : (
            <button
              onClick={alternarPush}
              disabled={pushOcupado || push === null}
              className={`mt-3 w-full rounded-xl px-6 py-5 text-lg font-black active:scale-[0.99] disabled:opacity-60 ${
                push === 'activo'
                  ? 'border-2 border-emerald-400 text-emerald-400'
                  : 'bg-[var(--edr-yellow)] text-black'
              }`}
            >
              {pushOcupado ? (
                'Un momento…'
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Bell size={18} strokeWidth={2} />
                  {push === 'activo' ? 'Activadas · tocá para desactivar' : 'Activar notificaciones'}
                </span>
              )}
            </button>
          )}
        </section>

        {/* ---------- Contraseña ---------- */}
        <section className="rounded-2xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <button
            onClick={() => setAbrirClave((v) => !v)}
            className="flex w-full items-center justify-between text-lg font-black"
          >
            Cambiar contraseña
            <span className="text-2xl leading-none">{abrirClave ? '−' : '+'}</span>
          </button>

          {abrirClave && (
            <div className="mt-4 space-y-3">
              <div>
                <label className={labelCls}>Contraseña nueva</label>
                <input
                  type="password"
                  className={inputCls}
                  value={pass1}
                  onChange={(e) => setPass1(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className={labelCls}>Repetila</label>
                <input
                  type="password"
                  className={inputCls}
                  value={pass2}
                  onChange={(e) => setPass2(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              <button
                onClick={changePassword}
                disabled={saving}
                className="w-full rounded-xl bg-[var(--edr-yellow)] px-6 py-5 text-lg font-black text-black active:scale-[0.99] disabled:opacity-60"
              >
                {saving ? 'Guardando…' : 'Guardar contraseña'}
              </button>
            </div>
          )}
        </section>

        <button
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/login');
          }}
          className="w-full rounded-xl border-2 border-[var(--edr-border)] px-6 py-4 text-lg font-black text-[var(--edr-muted)]"
        >
          Salir de la cuenta
        </button>
      </main>

    </div>
  );
}


