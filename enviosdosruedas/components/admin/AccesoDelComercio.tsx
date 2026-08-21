'use client';

import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { mensajeDeBienvenida, SITIO } from '@/lib/admin/mensajeComercio';

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
  /** Todavía no volvió el servidor con el nombre de usuario. */
  const [buscando, setBuscando] = useState(false);
  /** La ficha apunta a una cuenta que ya no existe. */
  const [roto, setRoto] = useState(false);

  useEffect(() => {
    let vivo = true;

    const traer = async () => {
      if (!tieneAcceso) {
        setUsuario('');
        setRoto(false);
        setNuevoUsuario(usuarioSugerido(nombre));
        return;
      }

      setBuscando(true);
      const { data } = await supabase.auth.getSession();
      const res = await fetch(`/api/comercio-users?client_id=${clientId}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      });
      const json = await res.json();
      if (!vivo) return;
      if (res.ok) {
        setUsuario(json.usuario ?? '');
        setRoto(Boolean(json.roto));
        setNuevoUsuario(json.usuario || usuarioSugerido(nombre));
      }
      setBuscando(false);
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [clientId, nombre, tieneAcceso]);

  /**
   * Si de verdad hay una cuenta andando.
   *
   * NO ALCANZA con que la ficha tenga el enlace: puede apuntar a una cuenta
   * borrada. Y al revés, mientras el servidor contesta no se sabe todavía, y
   * en ese rato no se puede ofrecer "Crear acceso" —si se ofrece, se termina
   * creando un segundo usuario para un comercio que ya tenía uno, y después
   * nadie sabe con cuál entra—.
   */
  const yaTiene = tieneAcceso && !roto;

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
      const r = await llamar('POST', {
        client_id: clientId,
        username: nuevoUsuario,
        password: clave,
      });
      setUsuario(nuevoUsuario.trim().toLowerCase());
      setRoto(false);
      return r.reconectado
        ? 'Ese usuario ya existía y se volvió a asociar a este comercio. La contraseña sigue siendo la de antes: si no la tenés, cambiala acá abajo.'
        : 'Acceso creado. Tocá "Copiar para WhatsApp": el mensaje sale con el usuario y la contraseña puestos.';
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

  /**
   * El mensaje de bienvenida listo para pegar en el WhatsApp del comercio.
   *
   * SIN LA CONTRASEÑA NO SE COPIA NADA. Antes, cuando el campo estaba vacío,
   * el mensaje salía igual diciendo "(la que te pasamos)". Ese texto se manda
   * sin releerlo, y del otro lado queda un comercio que no puede entrar y una
   * llamada preguntando cuál era la contraseña. Como una contraseña ya puesta
   * no se puede leer —Supabase guarda un resumen, no la contraseña—, el único
   * camino honesto es ponerle una nueva y mandar esa.
   */
  async function copiarDatos() {
    if (clave.length < 6) {
      setAviso('');
      setError(
        'Escribí la contraseña arriba para que entre en el mensaje. Si ya tenía una y no la tenés anotada, no se puede leer: poné una nueva, tocá "Cambiar contraseña" y después copiá.',
      );
      return;
    }

    try {
      await navigator.clipboard.writeText(mensajeDeBienvenida(usuario, clave));
      setError('');
      setAviso('Mensaje copiado con el usuario y la contraseña. Pegalo en el WhatsApp del comercio.');
    } catch {
      setError('El navegador no dejó copiar.');
    }
  }

  return (
    <section className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4">
      <h3 className="mb-1 flex items-center gap-2 font-black">
        <KeyRound size={16} /> Acceso al portal
      </h3>
      {yaTiene ? (
        <div className="mb-3 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
          <p className="text-sm font-bold text-[var(--edr-verde-claro)]">
            Ya tiene usuario creado
            {usuario && (
              <>
                :{' '}
                <span className="edr-mono text-[var(--edr-acento)]">{usuario}</span>
              </>
            )}
            {buscando && !usuario && <span className="font-normal"> …</span>}
          </p>
          <p className="mt-0.5 text-xs text-[var(--edr-muted)]">
            Entra en {SITIO}/login y ve sus envíos. Sólo mirar: no puede cargar ni cambiar nada. Acá
            se le puede cambiar la contraseña o el usuario, o sacarle el acceso.
          </p>
        </div>
      ) : roto ? (
        /* La ficha apuntaba a una cuenta borrada. Decirlo, porque si no la
           pantalla mostraría "ya tiene" y el comercio no podría entrar. */
        <div className="mb-3 rounded border border-orange-400/50 bg-orange-500/10 px-3 py-2">
          <p className="text-sm font-bold text-[var(--edr-naranja-claro)]">
            El usuario de este comercio ya no existe
          </p>
          <p className="mt-0.5 text-xs text-[var(--edr-muted)]">
            Alguien borró la cuenta. Creale una nueva acá abajo y pasásela.
          </p>
        </div>
      ) : (
        <p className="mb-3 text-xs text-[var(--edr-muted)]">
          Todavía no puede entrar. Creale un usuario y una contraseña, y pasáselos por WhatsApp.
        </p>
      )}

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
          <label className={labelCls}>{yaTiene ? 'Contraseña nueva' : 'Contraseña'}</label>
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
        {!yaTiene ? (
          <button
            onClick={crear}
            /* Mientras el servidor no conteste no se sabe si ya tiene cuenta,
               y crear a ciegas deja dos usuarios para el mismo comercio. */
            disabled={trabajando || buscando || !nuevoUsuario.trim() || clave.length < 6}
            className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] disabled:opacity-50"
          >
            {trabajando ? 'Creando…' : buscando ? 'Cargando…' : 'Crear acceso'}
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
