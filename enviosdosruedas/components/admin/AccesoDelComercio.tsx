'use client';

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * El usuario y la contraseña con los que entra un comercio.
 *
 * NO SE PUEDE VER UNA CONTRASEÑA, NI ACÁ NI EN NINGÚN LADO. Supabase guarda un
 * resumen irreversible, no la contraseña: si el comercio la pierde, se le pone
 * una nueva. Por eso la pantalla nunca ofrece "ver la contraseña" —sería una
 * promesa que no se puede cumplir— y sí ofrece cambiarla en dos toques.
 *
 * El usuario SÍ se puede ver, y hace falta: cuando el comercio llama diciendo
 * que no entra, la primera pregunta es con qué usuario está probando. Como vive
 * en la tabla de cuentas —que no se lee desde el navegador— se pide al
 * servidor, que es lo único que tiene la clave para leerla.
 */

const SITIO = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.logisticadosruedas.com').replace(
  /\/+$/,
  '',
);

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/**
 * Un usuario propuesto a partir del nombre: "AMA Y POLA" → "amaypola".
 *
 * Sin acentos ni eñes: el comercio lo escribe desde el teclado del celular y
 * "amaypoló" es una forma segura de que no pueda entrar nunca.
 */
export function usuarioSugerido(nombre: string): string {
  return nombre
    .normalize('NFD')
    // Los acentos quedan como caracteres sueltos después de `normalize`, y
    // ese es el rango donde caen. Va escrito con el código y no con la tilde
    // de verdad, que según el editor se puede perder sin que se note.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export default function AccesoDelComercio({
  clientId,
  nombre,
  tieneAcceso,
  onCambio,
}: {
  clientId: number;
  nombre: string;
  /** Lo que dice la ficha. Sirve para dibujar antes de que conteste el servidor. */
  tieneAcceso: boolean;
  /** Para que la pantalla de arriba vuelva a leer la ficha. */
  onCambio: () => void;
}) {
  const [usuario, setUsuario] = useState('');
  const [nuevoUsuario, setNuevoUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    let vivo = true;

    const traer = async () => {
      if (!tieneAcceso) {
        setUsuario('');
        setNuevoUsuario(usuarioSugerido(nombre));
        return;
      }
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`/api/comercio-users?client_id=${clientId}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      });
      const json = await res.json();
      if (!vivo) return;
      if (res.ok) {
        setUsuario(json.usuario ?? '');
        setNuevoUsuario(json.usuario ?? '');
      }
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [clientId, nombre, tieneAcceso]);

  async function llamar(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/comercio-users', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'No se pudo completar.');
    return json;
  }

  async function hacer(que: () => Promise<string>) {
    setTrabajando(true);
    setError('');
    setAviso('');
    try {
      setAviso(await que());
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo.');
    }
    setTrabajando(false);
  }

  const crear = () =>
    hacer(async () => {
      await llamar('POST', { client_id: clientId, username: nuevoUsuario, password: clave });
      setUsuario(nuevoUsuario.trim().toLowerCase());
      return 'Acceso creado. Copiá los datos y mandáselos al comercio.';
    });

  const cambiarClave = () =>
    hacer(async () => {
      await llamar('PATCH', { client_id: clientId, password: clave });
      return 'Contraseña cambiada. Mandale la nueva al comercio.';
    });

  const cambiarUsuario = () =>
    hacer(async () => {
      await llamar('PATCH', { client_id: clientId, username: nuevoUsuario });
      setUsuario(nuevoUsuario.trim().toLowerCase());
      return 'Usuario cambiado.';
    });

  const quitar = () => {
    if (
      !confirm(
        `¿Sacarle el acceso a ${nombre}?\n\nDeja de poder entrar a ver sus envíos. Los envíos, la ficha y todo lo demás quedan intactos, y se le puede volver a dar acceso cuando quieras.`,
      )
    )
      return;
    return hacer(async () => {
      await llamar('DELETE', { client_id: clientId });
      setUsuario('');
      setClave('');
      return 'Acceso dado de baja.';
    });
  };

  /** El mensaje listo para pegar en el WhatsApp del comercio. */
  async function copiarDatos() {
    const texto =
      `Ya podés ver tus envíos online:\n${SITIO}/login\n\n` +
      `Usuario: ${usuario}\n` +
      `Contraseña: ${clave || '(la que te pasamos)'}\n\n` +
      `Ahí vas a ver todos tus envíos, el link de seguimiento para mandarle a tu cliente ` +
      `y el comprobante de entrega con foto.`;
    try {
      await navigator.clipboard.writeText(texto);
      setAviso('Mensaje copiado: pegalo en el WhatsApp del comercio.');
    } catch {
      setError('El navegador no dejó copiar.');
    }
  }

  return (
    <section className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
      <h3 className="mb-1 flex items-center gap-2 font-black">
        <KeyRound size={16} /> Acceso al portal
      </h3>
      <p className="mb-3 text-xs text-[var(--edr-muted)]">
        {tieneAcceso ? (
          <>
            Entra como <strong className="edr-mono text-[var(--edr-acento)]">{usuario || '…'}</strong>{' '}
            en {SITIO}/login y ve sus envíos. Sólo mirar: no puede cargar ni cambiar nada.
          </>
        ) : (
          <>
            Todavía no puede entrar. Creale un usuario y una contraseña, y pasáselos por WhatsApp.
          </>
        )}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label className={labelCls}>Usuario</label>
          <input
            className={campo}
            value={nuevoUsuario}
            onChange={(e) => setNuevoUsuario(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="toypiola"
          />
        </div>
        <div className="flex-1">
          <label className={labelCls}>{tieneAcceso ? 'Contraseña nueva' : 'Contraseña'}</label>
          <input
            className={campo}
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="al menos 6 caracteres"
          />
        </div>
      </div>

      {/* La contraseña se escribe a la vista y no tapada con puntitos: acá no
          la está escribiendo su dueño para entrar, la está eligiendo alguien
          para dictársela a otro. Taparla sólo serviría para escribirla mal. */}

      <div className="mt-3 flex flex-wrap gap-2">
        {!tieneAcceso ? (
          <button
            onClick={crear}
            disabled={trabajando || !nuevoUsuario.trim() || clave.length < 6}
            className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] disabled:opacity-50"
          >
            {trabajando ? 'Creando…' : 'Crear acceso'}
          </button>
        ) : (
          <>
            <button
              onClick={cambiarClave}
              disabled={trabajando || clave.length < 6}
              className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] disabled:opacity-50"
            >
              {trabajando ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
            <button
              onClick={cambiarUsuario}
              disabled={
                trabajando || !nuevoUsuario.trim() || nuevoUsuario.trim().toLowerCase() === usuario
              }
              className="rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-bold hover:bg-[var(--edr-surface-2)] disabled:opacity-50"
            >
              Cambiar usuario
            </button>
            <button
              onClick={copiarDatos}
              disabled={trabajando || !usuario}
              className="rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-bold hover:bg-[var(--edr-surface-2)] disabled:opacity-50"
            >
              Copiar para WhatsApp
            </button>
            <button
              onClick={quitar}
              disabled={trabajando}
              className="ml-auto text-xs font-bold text-[var(--edr-muted)] underline underline-offset-4 disabled:opacity-50"
            >
              Sacarle el acceso
            </button>
          </>
        )}
      </div>

      {aviso && (
        <div className="mt-3 rounded border border-emerald-400 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
          {aviso}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}
    </section>
  );
}
