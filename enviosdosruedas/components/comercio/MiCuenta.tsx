'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Store } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  CAMPOS_PEDIBLES,
  NOMBRE_CAMPO,
  cancelarPedido,
  miSolicitudPendiente,
  miUltimaResuelta,
  pedirCambio,
  type CampoPedible,
  type Solicitud,
} from '@/lib/comercio/solicitudes';
import type { FichaComercio } from '@/components/comercio/ResumenDelComercio';

/**
 * Lo que el comercio puede hacer con su propia cuenta.
 *
 * DOS COSAS Y SE COMPORTAN DISTINTO, a propósito.
 *
 * La CONTRASEÑA la cambia solo y al toque: es suya, no afecta a nadie más, y
 * hacerlo esperar una autorización para entrar a su propia cuenta sería una
 * traba sin motivo.
 *
 * Los DATOS los pide. La dirección de retiro no es un dato del comercio: es a
 * dónde mandamos una moto todos los días. Si se pudiera cambiar solo, un error
 * de tipeo un domingo a la noche manda al repartidor a otra cuadra el lunes a
 * la mañana, y nadie se entera hasta que llama.
 */

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]';
const etiqueta =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

export default function MiCuenta({
  comercio,
  onCerrar,
}: {
  comercio: FichaComercio;
  onCerrar: () => void;
}) {
  const [pendiente, setPendiente] = useState<Solicitud | null>(null);
  const [ultima, setUltima] = useState<Solicitud | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  const [datos, setDatos] = useState<Record<CampoPedible, string>>({
    phone: comercio.phone ?? '',
    pickup_address: comercio.pickup_address ?? '',
    pickup_extra: comercio.pickup_extra ?? '',
    pickup_notes: comercio.pickup_notes ?? '',
    pickup_window: comercio.pickup_window ?? '',
    pickup_window_sabado: comercio.pickup_window_sabado ?? '',
  });
  const [nota, setNota] = useState('');

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [verClave, setVerClave] = useState(false);

  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    let vivo = true;

    const traer = async () => {
      const [p, u] = await Promise.all([
        miSolicitudPendiente(comercio.id),
        miUltimaResuelta(comercio.id),
      ]);
      if (!vivo) return;
      setPendiente(p);
      setUltima(u);
      setCargando(false);
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [comercio.id, version]);

  const set = (k: CampoPedible, v: string) => setDatos((d) => ({ ...d, [k]: v }));

  async function mandarPedido() {
    setTrabajando(true);
    setError('');
    setAviso('');

    const e = await pedirCambio(comercio.id, { ...datos, nota });
    setTrabajando(false);

    if (e) return setError(e);
    setNota('');
    setAviso('Pedido enviado. Te avisamos cuando lo revisemos.');
    setVersion((v) => v + 1);
  }

  async function cancelar() {
    if (!pendiente) return;
    setTrabajando(true);
    const e = await cancelarPedido(pendiente.id);
    setTrabajando(false);
    if (e) return setError(e);
    setAviso('Pedido cancelado.');
    setVersion((v) => v + 1);
  }

  /**
   * Cambiar la contraseña, pidiendo la de ahora.
   *
   * Supabase no la exige —con la sesión abierta alcanza— pero acá sí: estas
   * cuentas se usan en la computadora del local, con la sesión abierta todo el
   * día. Sin este paso, cualquiera que pase por ahí le cambia la contraseña y
   * lo deja afuera de su propia cuenta.
   */
  async function cambiarClave() {
    setError('');
    setAviso('');

    if (nueva.length < 6) return setError('La contraseña nueva tiene que tener al menos 6 caracteres.');
    if (nueva === actual) return setError('La contraseña nueva es igual a la de ahora.');

    setTrabajando(true);

    const { data: sesion } = await supabase.auth.getSession();
    const email = sesion.session?.user?.email;
    if (!email) {
      setTrabajando(false);
      return setError('Se cerró la sesión. Volvé a entrar.');
    }

    const { error: eActual } = await supabase.auth.signInWithPassword({
      email,
      password: actual,
    });

    if (eActual) {
      setTrabajando(false);
      return setError('La contraseña de ahora no es ésa.');
    }

    const { error: eNueva } = await supabase.auth.updateUser({ password: nueva });
    setTrabajando(false);

    if (eNueva) return setError(eNueva.message);

    setActual('');
    setNueva('');
    setAviso('Listo, contraseña cambiada. Usá la nueva la próxima vez que entres.');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--edr-border)] bg-[var(--edr-surface-2)] p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-black">Mi cuenta</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="px-2 text-2xl leading-none">
            ×
          </button>
        </div>

        {aviso && (
          <div className="mb-3 rounded border border-emerald-400 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
            {aviso}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* ------------------------------------------------- los datos */}
        <section className="mb-5 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <h3 className="mb-1 flex items-center gap-2 font-black">
            <Store size={16} /> Mis datos
          </h3>

          {cargando ? (
            <p className="text-xs text-[var(--edr-muted)]">Cargando…</p>
          ) : pendiente ? (
            /*
              Con un pedido esperando no se deja mandar otro: la base tampoco
              lo permite, y ofrecer un formulario que va a rebotar es peor que
              no ofrecerlo. Se muestra lo pedido y se puede cancelar.
            */
            <>
              <p className="mb-2 text-xs text-[var(--edr-muted)]">
                Ya nos mandaste un pedido el {fecha(pendiente.creada_at)} y lo estamos mirando.
                Cuando lo aprobemos, tus datos quedan actualizados.
              </p>
              <ul className="mb-3 rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-sm">
                {CAMPOS_PEDIBLES.filter((c) => (pendiente[c] ?? '').trim()).map((c) => (
                  <li key={c}>
                    <span className="text-[var(--edr-muted)]">{NOMBRE_CAMPO[c]}: </span>
                    <strong>{pendiente[c]}</strong>
                  </li>
                ))}
                {pendiente.nota && (
                  <li className="mt-1 text-[var(--edr-muted)]">“{pendiente.nota}”</li>
                )}
              </ul>
              <button
                onClick={cancelar}
                disabled={trabajando}
                className="text-xs font-bold text-[var(--edr-muted)] underline underline-offset-4 disabled:opacity-50"
              >
                Cancelar el pedido
              </button>
            </>
          ) : (
            <>
              <p className="mb-3 text-xs leading-snug text-[var(--edr-muted)]">
                Corregí lo que cambió y mandanos el pedido. No se aplica solo: lo revisamos primero,
                porque de esta dirección sale la moto todos los días.
              </p>

              {ultima?.estado === 'rechazada' && (
                <div className="mb-3 rounded border border-orange-400/50 bg-orange-500/10 px-3 py-2 text-xs">
                  <strong className="text-[var(--edr-naranja-claro)]">
                    Tu pedido del {fecha(ultima.creada_at)} no se aplicó.
                  </strong>
                  {ultima.motivo && <div className="mt-0.5">{ultima.motivo}</div>}
                </div>
              )}
              {ultima?.estado === 'aprobada' && (
                <div className="mb-3 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-[var(--edr-verde-claro)]">
                  Tu pedido del {fecha(ultima.creada_at)} ya está aplicado.
                </div>
              )}

              <div className="flex flex-col gap-3">
                {CAMPOS_PEDIBLES.map((c) => (
                  <div key={c}>
                    <label className={etiqueta}>{NOMBRE_CAMPO[c]}</label>
                    <input
                      className={campo}
                      value={datos[c]}
                      onChange={(e) => set(c, e.target.value)}
                      placeholder={
                        c === 'pickup_window'
                          ? '9 a 18 hs'
                          : c === 'pickup_window_sabado'
                            ? '9 a 13 hs · vacío = igual que siempre'
                            : ''
                      }
                    />
                  </div>
                ))}

                <div>
                  <label className={etiqueta}>¿Querés aclarar algo?</label>
                  <input
                    className={campo}
                    value={nota}
                    onChange={(e) => setNota(e.target.value)}
                    placeholder="Nos mudamos el lunes"
                  />
                </div>

                <button
                  onClick={mandarPedido}
                  disabled={trabajando}
                  className="w-full rounded-full bg-[var(--edr-yellow)] px-4 py-3 font-black text-[var(--edr-blue)] disabled:opacity-60"
                >
                  {trabajando ? 'Mandando…' : 'Pedir el cambio'}
                </button>
              </div>
            </>
          )}
        </section>

        {/* -------------------------------------------- la contraseña */}
        <section className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
          <h3 className="mb-1 flex items-center gap-2 font-black">
            <KeyRound size={16} /> Cambiar la contraseña
          </h3>
          <p className="mb-3 text-xs text-[var(--edr-muted)]">
            Ésta la cambiás vos y queda al instante. Te pedimos la de ahora para que nadie te la
            cambie si te dejás la sesión abierta.
          </p>

          <div className="flex flex-col gap-3">
            <div>
              <label className={etiqueta}>La de ahora</label>
              <input
                type={verClave ? 'text' : 'password'}
                className={campo}
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className={etiqueta}>La nueva</label>
              <div className="relative">
                <input
                  type={verClave ? 'text' : 'password'}
                  className={`${campo} pr-11`}
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="al menos 6 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setVerClave((v) => !v)}
                  aria-label={verClave ? 'Ocultar las contraseñas' : 'Ver las contraseñas'}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-[var(--edr-muted)] hover:text-[var(--edr-yellow)]"
                >
                  {verClave ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              onClick={cambiarClave}
              disabled={trabajando || !actual || nueva.length < 6}
              className="w-full rounded-full border border-[var(--edr-border)] px-4 py-3 font-bold disabled:opacity-50"
            >
              {trabajando ? 'Guardando…' : 'Cambiar la contraseña'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
