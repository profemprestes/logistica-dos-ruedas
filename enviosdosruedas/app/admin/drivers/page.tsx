'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';

interface Usuario {
  id: string;
  full_name: string;
  phone: string | null;
  vehicle: string | null;
  active: boolean;
  role: string;
  created_at: string;
}

/**
 * Cómo se llama cada rol EN LA PANTALLA, y de qué color.
 *
 * Hasta hoy todo lo que no era admin decía "Repartidor", así que los ocho
 * comercios que entran a su portal figuraban como motos. No cambiaba lo que
 * podían hacer —eso lo deciden los permisos de la base— pero sí lo que se
 * entendía mirando la lista, que es para lo que existe la lista.
 */
const ROLES: Record<string, { nombre: string; clase: string }> = {
  admin: {
    nombre: 'Administrador',
    clase: 'bg-[var(--edr-blue)] text-white ring-[var(--edr-yellow)]',
  },
  repartidor: {
    nombre: 'Repartidor',
    clase: 'bg-[var(--edr-surface-2)] text-[var(--edr-acento)] ring-[var(--edr-yellow)]',
  },
  comercio: {
    nombre: 'Comercio',
    clase: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  },
};

function comoSeLlamaElRol(rol: string) {
  // Un rol que no esté en la lista se muestra tal cual y no como "Repartidor":
  // si mañana aparece uno nuevo, mejor leer una palabra rara que una mentira.
  return ROLES[rol] ?? { nombre: rol || 'Sin rol', clase: 'bg-amber-50 text-amber-900 ring-amber-300' };
}

/** El orden de la lista: primero la oficina, después las motos, después los comercios. */
const ORDEN = ['admin', 'repartidor', 'comercio'];

function porRolYNombre(a: Usuario, b: Usuario) {
  const ia = ORDEN.indexOf(a.role);
  const ib = ORDEN.indexOf(b.role);
  if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  return (a.full_name || '').localeCompare(b.full_name || '', 'es');
}

const field =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--edr-acento)] focus:ring-2 focus:ring-[var(--edr-yellow)]/10';
const labelCls = 'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

const EMPTY = { full_name: '', username: '', password: '', phone: '', vehicle: '' };

/** Consulta suelta, sin estado adentro: se puede disparar desde un efecto. */
function fetchProfiles() {
  return supabase.from('profiles').select('*').order('full_name');
}

export default function DriversPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [drivers, setDrivers] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Usuario | null>(null);
  const [newPassword, setNewPassword] = useState('');
  /** Qué roles mirar. Vacío = todos. */
  const [soloRol, setSoloRol] = useState('');

  const apply = useCallback(
    ({ data, error: dbError }: Awaited<ReturnType<typeof fetchProfiles>>) => {
      if (dbError) setError(dbError.message);
      else setDrivers((data ?? []) as Usuario[]);
      setLoading(false);
    },
    [],
  );

  /** Refresco a mano, después de crear o editar un repartidor. */
  const load = useCallback(() => {
    setLoading(true);
    return fetchProfiles().then(apply);
  }, [apply]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchProfiles().then((res) => {
      if (!cancelled) apply(res);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, apply]);

  /** Todas las llamadas al servidor mandan el token para probar que sos admin. */
  async function callApi(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/drivers', {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.session?.access_token ?? ''}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'No se pudo completar la operación.');
    return json;
  }

  async function createDriver() {
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await callApi('POST', form);
      setNotice(`Repartidor creado. Entra con el usuario ${form.username} y la contraseña que le pusiste.`);
      setForm(EMPTY);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
    setCreating(false);
  }

  async function saveEdit() {
    if (!editing) return;
    setError('');
    setNotice('');
    try {
      await callApi('PATCH', {
        id: editing.id,
        full_name: editing.full_name,
        phone: editing.phone,
        vehicle: editing.vehicle,
        ...(newPassword ? { password: newPassword } : {}),
      });
      setNotice(newPassword ? 'Datos y contraseña actualizados.' : 'Datos actualizados.');
      setEditing(null);
      setNewPassword('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }

  async function toggleActive(u: Usuario) {
    setError('');
    try {
      await callApi('PATCH', { id: u.id, active: !u.active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }

  async function removeDriver(u: Usuario) {
    /*
     * El aviso cambia según el rol, porque lo que se pierde es distinto.
     *
     * Antes decía "se pierde su historial de entregas" para todos. Aplicado a
     * un comercio eso es falso y encima asusta de lo que no es: sus envíos no
     * se tocan. Lo que pierde es la puerta para entrar a mirarlos.
     */
    const aviso =
      u.role === 'comercio'
        ? `¿Eliminar la cuenta de ${u.full_name}?\n\n` +
          'Pierde el acceso a su portal. La ficha del comercio, sus envíos y su historial NO se ' +
          'borran: la ficha queda sin usuario y podés crearle otro desde Comercios.'
        : `¿Eliminar a ${u.full_name}?\n\n` +
          'Se pierde su historial de entregas. Si solo dejó de trabajar, conviene desactivarlo en ' +
          'vez de borrarlo.';

    if (!confirm(aviso)) return;
    setError('');
    try {
      await callApi('DELETE', { id: u.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    }
  }

  /*
   * Lo que se ve: filtrado por rol y ordenado por rol.
   *
   * Con doce cuentas mezcladas —una de oficina, tres motos y ocho comercios—
   * la lista alfabética obligaba a leerla entera para encontrar a alguien.
   */
  const visibles = drivers.filter((d) => !soloRol || d.role === soloRol).sort(porRolYNombre);

  const cuantos = (rol: string) => drivers.filter((d) => d.role === rol).length;

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  return (
    <div className="min-h-full">

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Alta */}
        <section className="mb-8 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-5">
          <h2 className="mb-4 text-base font-bold">Nuevo repartidor</h2>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <div>
              <label className={labelCls}>Nombre y apellido *</label>
              <input
                className={field}
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                placeholder="Juan Pérez"
              />
            </div>
            <div>
              <label className={labelCls}>Usuario *</label>
              <input
                className={field}
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="juan.perez"
              />
            </div>
            <div>
              <label className={labelCls}>Contraseña *</label>
              <input
                className={field}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className={labelCls}>Teléfono</label>
              <input
                className={field}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label className={labelCls}>Moto / vehículo</label>
              <input
                className={field}
                value={form.vehicle}
                onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                placeholder="Honda Wave AB123CD"
              />
            </div>
          </div>

          <button
            onClick={createDriver}
            disabled={creating}
            className="mt-4 rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
          >
            {creating ? 'Creando…' : 'Crear repartidor'}
          </button>

          <p className="mt-3 text-xs text-[var(--edr-muted)]">
            El repartidor entra con su usuario y contraseña desde el celular. Anotá la contraseña y
            pasásela: por seguridad no se puede volver a ver, solo cambiar.
          </p>
          {/* Este formulario crea REPARTIDORES y nada más. El usuario de un
              comercio se crea en su ficha porque ahí se lo enlaza con ella: uno
              creado suelto acá entraría a un portal vacío. */}
          <p className="mt-1 text-xs text-[var(--edr-muted)]">
            Los usuarios de comercio se crean desde <strong>Comercios</strong>, en la ficha de cada
            uno: ahí quedan enlazados a su local y ven sus envíos.
          </p>
        </section>

        {notice && (
          <div className="mb-4 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Listado */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {[
            { valor: '', texto: `Todos (${drivers.length})` },
            { valor: 'admin', texto: `Oficina (${cuantos('admin')})` },
            { valor: 'repartidor', texto: `Repartidores (${cuantos('repartidor')})` },
            { valor: 'comercio', texto: `Comercios (${cuantos('comercio')})` },
          ].map((f) => (
            <button
              key={f.valor}
              onClick={() => setSoloRol(f.valor)}
              className={`rounded border px-3 py-1.5 text-xs font-bold ${
                soloRol === f.valor
                  ? 'border-[var(--edr-yellow)] bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                  : 'border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
              }`}
            >
              {f.texto}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)]">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--edr-border)] bg-[var(--edr-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--edr-muted)]">
              <tr>
                <th className="px-3 py-2">Nombre</th>
                <th className="px-3 py-2">Teléfono</th>
                <th className="px-3 py-2">Vehículo</th>
                <th className="px-3 py-2">Rol</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                    Cargando…
                  </td>
                </tr>
              )}

              {!loading && visibles.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                    {soloRol
                      ? 'Ninguna cuenta con ese rol.'
                      : 'Todavía no hay ninguna cuenta. Creá la primera arriba.'}
                  </td>
                </tr>
              )}

              {visibles.map((d) => (
                <tr key={d.id} className="border-b border-[var(--edr-border)] last:border-0 hover:bg-[var(--edr-surface-2)]">
                  <td className="px-3 py-2 font-semibold">{d.full_name || '—'}</td>
                  <td className="edr-mono px-3 py-2">{d.phone || '—'}</td>
                  <td className="px-3 py-2">{d.role === 'repartidor' ? d.vehicle || '—' : '—'}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${comoSeLlamaElRol(d.role).clase}`}
                    >
                      {comoSeLlamaElRol(d.role).nombre}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${
                        d.active
                          ? 'bg-emerald-50 text-emerald-800 ring-emerald-300'
                          : 'bg-[var(--edr-surface-2)] text-[var(--edr-muted)] ring-neutral-300'
                      }`}
                    >
                      {d.active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        setEditing(d);
                        setNewPassword('');
                      }}
                      className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => toggleActive(d)}
                      className="ml-1 rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                    >
                      {d.active ? 'Desactivar' : 'Activar'}
                    </button>
                    {d.role !== 'admin' && (
                      <button
                        onClick={() => removeDriver(d)}
                        className="ml-1 rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal de edición */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-10 w-full max-w-lg rounded-lg bg-[var(--edr-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
              <h2 className="text-lg font-bold">
                Editar {comoSeLlamaElRol(editing.role).nombre.toLowerCase()}
              </h2>
              <button
                onClick={() => setEditing(null)}
                className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 px-5 py-5">
              <div>
                <label className={labelCls}>Nombre y apellido</label>
                <input
                  className={field}
                  value={editing.full_name}
                  onChange={(e) => setEditing({ ...editing, full_name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>Teléfono</label>
                <input
                  className={field}
                  value={editing.phone ?? ''}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                />
              </div>
              {/* La moto sólo existe para el que reparte. En un comercio el campo
                  estaba y se podía llenar, y lo que se escribiera ahí no lo iba
                  a leer nadie nunca. */}
              {editing.role === 'repartidor' && (
                <div>
                  <label className={labelCls}>Moto / vehículo</label>
                  <input
                    className={field}
                    value={editing.vehicle ?? ''}
                    onChange={(e) => setEditing({ ...editing, vehicle: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>Nueva contraseña (opcional)</label>
                <input
                  className={field}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="dejar vacío para no cambiarla"
                />
                {editing.role === 'comercio' && (
                  <p className="mt-1 text-xs text-[var(--edr-muted)]">
                    Es la contraseña con la que entra a su portal. También se puede cambiar desde
                    su ficha en Comercios.
                  </p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
              <button
                onClick={() => setEditing(null)}
                className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                className="rounded bg-[var(--edr-yellow)] px-5 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95"
              >
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
