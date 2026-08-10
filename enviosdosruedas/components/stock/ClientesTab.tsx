'use client';

import { useState } from 'react';
import { createClient, deleteClient, updateClient } from '@/lib/stock/db';
import type { StockClient } from '@/lib/stock/types';
import { supabase } from '@/lib/supabaseClient';
import { btnGhost, btnPrimary, btnSmall, card, field, labelCls, tableHead, tableWrap } from './ui';

interface Props {
  clientes: StockClient[];
  /** Cuántos productos tiene cada cliente, para la columna de la tabla. */
  conteos: Record<string, number>;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

const VACIO = { nombre: '', prefijo: '', sufijo: 'EDR' };

export default function ClientesTab({ clientes, conteos, onReload, onError, onNotice }: Props) {
  const [form, setForm] = useState(VACIO);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<StockClient | null>(null);

  /** Alta o cambio de contraseña del acceso del comercio. */
  const [acceso, setAcceso] = useState<StockClient | null>(null);
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [guardandoAcceso, setGuardandoAcceso] = useState(false);

  /** Igual que en repartidores: el token prueba que sos admin del lado servidor. */
  async function callApi(method: 'POST' | 'PATCH' | 'DELETE', body: unknown) {
    const { data } = await supabase.auth.getSession();
    const res = await fetch('/api/stock-users', {
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

  async function crear() {
    if (!form.nombre.trim() || !form.prefijo.trim())
      return onError('Completá el nombre del comercio y el prefijo.');

    setCreando(true);
    onError('');
    try {
      await createClient({
        nombre: form.nombre.trim(),
        prefijo: form.prefijo.trim().toUpperCase(),
        sufijo: form.sufijo.trim().toUpperCase() || 'EDR',
      });
      onNotice('Cliente creado. Ahora cargale los productos desde la pestaña Stock.');
      setForm(VACIO);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo crear el cliente.');
    }
    setCreando(false);
  }

  async function guardarEdicion() {
    if (!editando) return;
    onError('');
    try {
      await updateClient(editando.id, {
        nombre: editando.nombre,
        prefijo: editando.prefijo.toUpperCase(),
        sufijo: editando.sufijo.toUpperCase(),
      });
      setEditando(null);
      onNotice('Cliente actualizado.');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  async function alternarActivo(c: StockClient) {
    onError('');
    try {
      await updateClient(c.id, { activo: !c.activo });
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo cambiar el estado.');
    }
  }

  async function guardarAcceso() {
    if (!acceso) return;
    setGuardandoAcceso(true);
    onError('');
    try {
      if (acceso.profile_id) {
        await callApi('PATCH', { client_id: acceso.id, password: clave });
        onNotice(`Contraseña de ${acceso.nombre} actualizada.`);
      } else {
        await callApi('POST', { client_id: acceso.id, username: usuario, password: clave });
        onNotice(
          `Acceso creado. ${acceso.nombre} entra con el usuario ${usuario} y la contraseña que le pusiste.`
        );
      }
      setAcceso(null);
      setUsuario('');
      setClave('');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo guardar el acceso.');
    }
    setGuardandoAcceso(false);
  }

  async function borrarCliente(c: StockClient) {
    const productos = conteos[c.id] ?? 0;
    if (
      !confirm(
        `¿Eliminar a ${c.nombre}?\n\nSe borran sus ${productos} producto(s) y TODO el historial de entradas y salidas. No hay vuelta atrás.\n\nSi sólo dejó de operar, conviene desactivarlo: se guarda todo y deja de aparecer.`
      )
    )
      return;

    // Segunda traba a propósito: escribir el nombre obliga a mirar cuál es.
    if (prompt(`Escribí "${c.nombre}" para confirmar que va este cliente y no otro:`)?.trim() !== c.nombre)
      return onError('El nombre no coincide: no se borró nada.');

    onError('');
    try {
      if (c.profile_id) await callApi('DELETE', { client_id: c.id });
      await deleteClient(c.id);
      onNotice(`${c.nombre} y todo su historial fueron eliminados.`);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo eliminar el cliente.');
    }
  }

  async function quitarAcceso(c: StockClient) {
    if (
      !confirm(
        `¿Dar de baja el acceso de ${c.nombre}?\n\nSe borra el usuario con el que entra a ver su stock. El stock y el historial quedan intactos.`
      )
    )
      return;
    onError('');
    try {
      await callApi('DELETE', { client_id: c.id });
      onNotice('Acceso dado de baja.');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo dar de baja el acceso.');
    }
  }

  return (
    <div className="space-y-6">
      {/* Alta -------------------------------------------------------- */}
      <section className={card}>
        <h2 className="mb-1 text-base font-bold">Nuevo cliente</h2>
        <p className="mb-4 text-xs text-[var(--edr-muted)]">
          El prefijo define el código de sus productos. Shippy con prefijo SH genera{' '}
          <span className="edr-mono">SH00000001EDR</span>. El usuario para que entre a ver su stock se crea
          después, desde la tabla.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Nombre del comercio *</label>
            <input
              className={field}
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Shippy"
            />
          </div>
          <div>
            <label className={labelCls}>Prefijo *</label>
            <input
              className={`${field} uppercase`}
              value={form.prefijo}
              maxLength={6}
              onChange={(e) => setForm({ ...form, prefijo: e.target.value })}
              placeholder="SH"
            />
          </div>
          <div>
            <label className={labelCls}>Sufijo</label>
            <input
              className={`${field} uppercase`}
              value={form.sufijo}
              maxLength={6}
              onChange={(e) => setForm({ ...form, sufijo: e.target.value })}
            />
          </div>
          <div className="self-end">
            <button onClick={crear} disabled={creando} className={`${btnPrimary} w-full`}>
              {creando ? 'Creando…' : 'Crear cliente'}
            </button>
          </div>
        </div>
      </section>

      {/* Listado ----------------------------------------------------- */}
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <thead className={tableHead}>
            <tr>
              <th className="px-3 py-2">Cliente</th>
              <th className="px-3 py-2">Próximo código</th>
              <th className="px-3 py-2 text-right">Productos</th>
              <th className="px-3 py-2">Acceso</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {clientes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                  Todavía no hay clientes con stock en depósito. Creá el primero arriba.
                </td>
              </tr>
            )}

            {clientes.map((c) => (
              <tr
                key={c.id}
                className="border-b border-[var(--edr-border)] last:border-0 hover:bg-[var(--edr-surface-2)]"
              >
                <td className="px-3 py-2 font-semibold">{c.nombre}</td>
                <td className="edr-mono px-3 py-2 text-xs">
                  {c.prefijo}
                  {String(c.contador + 1).padStart(8, '0')}
                  {c.sufijo}
                </td>
                <td className="edr-mono px-3 py-2 text-right">{conteos[c.id] ?? 0}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${
                      c.profile_id
                        ? 'bg-emerald-950 text-emerald-200 ring-emerald-400'
                        : 'bg-[var(--edr-surface-2)] text-[var(--edr-muted)] ring-[var(--edr-border)]'
                    }`}
                  >
                    {c.profile_id ? 'Con usuario' : 'Sin usuario'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${
                      c.activo
                        ? 'bg-emerald-950 text-emerald-200 ring-emerald-400'
                        : 'bg-[var(--edr-surface-2)] text-[var(--edr-muted)] ring-[var(--edr-border)]'
                    }`}
                  >
                    {c.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <button onClick={() => setEditando(c)} className={btnSmall}>
                    Editar
                  </button>
                  <button
                    onClick={() => {
                      setAcceso(c);
                      setUsuario('');
                      setClave('');
                    }}
                    className={`${btnSmall} ml-1`}
                  >
                    {c.profile_id ? 'Cambiar clave' : 'Crear acceso'}
                  </button>
                  {c.profile_id && (
                    <button
                      onClick={() => quitarAcceso(c)}
                      className="ml-1 rounded border border-red-400 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-950"
                    >
                      Baja acceso
                    </button>
                  )}
                  <button onClick={() => alternarActivo(c)} className={`${btnSmall} ml-1`}>
                    {c.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  <button
                    onClick={() => borrarCliente(c)}
                    className="ml-1 rounded border border-red-400 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-950"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal editar cliente ---------------------------------------- */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-16 w-full max-w-md rounded-lg bg-[var(--edr-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
              <h2 className="text-lg font-bold">Editar cliente</h2>
              <button
                onClick={() => setEditando(null)}
                className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 px-5 py-5">
              <div>
                <label className={labelCls}>Nombre</label>
                <input
                  className={field}
                  value={editando.nombre}
                  onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Prefijo</label>
                  <input
                    className={`${field} uppercase`}
                    maxLength={6}
                    value={editando.prefijo}
                    onChange={(e) => setEditando({ ...editando, prefijo: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelCls}>Sufijo</label>
                  <input
                    className={`${field} uppercase`}
                    maxLength={6}
                    value={editando.sufijo}
                    onChange={(e) => setEditando({ ...editando, sufijo: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-[var(--edr-muted)]">
                Cambiar el prefijo no renombra los códigos ya emitidos: sólo afecta a los productos nuevos.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
              <button onClick={() => setEditando(null)} className={btnGhost}>
                Cancelar
              </button>
              <button onClick={guardarEdicion} className={btnPrimary}>
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal acceso ------------------------------------------------ */}
      {acceso && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-16 w-full max-w-md rounded-lg bg-[var(--edr-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
              <h2 className="text-lg font-bold">
                {acceso.profile_id ? 'Cambiar contraseña' : 'Crear acceso'} · {acceso.nombre}
              </h2>
              <button
                onClick={() => setAcceso(null)}
                className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 px-5 py-5">
              {!acceso.profile_id && (
                <div>
                  <label className={labelCls}>Usuario</label>
                  <input
                    className={field}
                    value={usuario}
                    autoCapitalize="none"
                    autoCorrect="off"
                    onChange={(e) => setUsuario(e.target.value)}
                    placeholder="shippy"
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>Contraseña</label>
                <input
                  className={field}
                  value={clave}
                  onChange={(e) => setClave(e.target.value)}
                  placeholder="mínimo 6 caracteres"
                />
              </div>
              <p className="text-xs text-[var(--edr-muted)]">
                Con este usuario el comercio entra por la misma pantalla de login y ve su stock en
                <span className="edr-mono"> /stock</span>. Sólo lee: no puede cargar ni descontar nada.
                Anotá la contraseña y pasásela; después no se puede volver a ver, solo cambiar.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
              <button onClick={() => setAcceso(null)} className={btnGhost}>
                Cancelar
              </button>
              <button onClick={guardarAcceso} disabled={guardandoAcceso} className={btnPrimary}>
                {guardandoAcceso ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
