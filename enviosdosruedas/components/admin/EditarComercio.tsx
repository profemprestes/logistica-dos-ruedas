'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import VerificarPunto from '@/components/admin/VerificarPunto';

/**
 * La ficha de un comercio: el cuadro para darlo de alta y para corregirlo.
 *
 * Vive suelto porque se abre desde dos lados —la lista de comercios y la
 * pantalla de un comercio— y son los mismos campos. Copiado en dos lugares,
 * agregar un campo sería agregarlo dos veces y descubrir la segunda un mes
 * después, cuando alguien note que desde una pantalla no se puede cargar el
 * horario.
 */

export interface Comercio {
  id: number;
  name: string;
  phone: string | null;
  pickup_address: string | null;
  /**
   * Piso, depto o local.
   *
   * VA SEPARADO de la dirección y no pegado atrás, porque el buscador de
   * direcciones no entiende "Belgrano 2875 5A" — eso no existe como dirección y
   * la búsqueda falla entera. Mismo criterio que `address_extra` en los envíos.
   */
  pickup_extra: string | null;
  pickup_notes: string | null;
  pickup_window: string | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  /** El usuario con el que entra al portal. Null si todavía no tiene acceso. */
  profile_id?: string | null;
  /**
   * De qué comercio es sucursal esta ficha. Null si es un comercio suelto o si
   * es la casa central.
   *
   * Una sucursal es una ficha común: tiene su dirección, su punto en el mapa,
   * su horario y sus notas, porque es otro local y abre distinto. Lo único que
   * agrega esto es de quién es, y con eso el portal muestra los envíos de
   * todos los locales juntos bajo un solo usuario. Ver el paso 50.
   */
  parent_id?: number | null;
}

export const VACIO: Omit<Comercio, 'id'> = {
  name: '',
  phone: null,
  pickup_address: null,
  pickup_extra: null,
  pickup_notes: null,
  pickup_window: null,
  lat: null,
  lng: null,
  active: true,
};

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/**
 * Borra un comercio, preguntando primero. Devuelve `null` si se arrepintió.
 *
 * LOS ENVÍOS VIEJOS NO SE VAN CON ÉL. El vínculo se corta —queda en null— pero
 * el nombre y la dirección de retiro están escritos en cada envío como texto,
 * así que el historial se sigue leyendo igual. Eso ya estaba previsto en el
 * paso 40 y por eso borrar acá es seguro.
 *
 * Se avisa cuántos envíos lo apuntan antes de preguntar. "¿Borrar TOY PIOLA?"
 * y "¿Borrar TOY PIOLA, que está en 47 envíos?" son dos preguntas distintas, y
 * la segunda es la que hay que contestar.
 *
 * OJO: el comercio se vuelve a crear solo si alguien escribe ese nombre al
 * cargar un envío. Para uno eventual —que se cargó una vez y no vuelve— esto
 * alcanza; para dejar de verlo sin borrarlo está el "Activo".
 */
export async function borrarComercio(c: Comercio): Promise<{ error?: string } | null> {
  const { count } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', c.id);

  const cuantos = count ?? 0;
  const aviso =
    cuantos > 0
      ? `¿Borrar ${c.name}?

Está en ${cuantos} envío(s). Esos envíos NO se borran y siguen mostrando "${c.name}" y su dirección: lo único que se pierde es el punto guardado para el mapa.${
          c.profile_id ? '\n\nY el acceso al portal también se cae: deja de poder entrar a mirar.' : ''
        }`
      : `¿Borrar ${c.name}? No hay ningún envío que lo use.`;

  if (!confirm(aviso)) return null;

  const { error } = await supabase.from('clients').delete().eq('id', c.id);
  return { error: error?.message };
}

/** El cuadro de alta y edición. Uno solo para las dos cosas: son los mismos campos. */
export default function EditarComercio({
  comercio,
  onCerrar,
  onGuardado,
  onBorrado,
}: {
  comercio: Comercio | Omit<Comercio, 'id'>;
  onCerrar: () => void;
  onGuardado: () => void;
  /** Qué hacer después de borrarlo. Si no se pasa, se avisa como guardado. */
  onBorrado?: () => void;
}) {
  const esNuevo = !('id' in comercio);
  const [form, setForm] = useState({
    name: comercio.name,
    phone: comercio.phone ?? '',
    pickup_address: comercio.pickup_address ?? '',
    pickup_extra: comercio.pickup_extra ?? '',
    pickup_notes: comercio.pickup_notes ?? '',
    pickup_window: comercio.pickup_window ?? '',
    lat: comercio.lat,
    lng: comercio.lng,
    active: comercio.active,
    parent_id: comercio.parent_id ?? null,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  /** Los que pueden ser casa central de éste. */
  const [centrales, setCentrales] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    let vivo = true;

    const traer = async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, name, parent_id')
        .order('name');
      if (!vivo) return;

      const propio = 'id' in comercio ? comercio.id : -1;
      setCentrales(
        (data ?? [])
          // Una sucursal no puede ser casa central de otra: un solo nivel. Y
          // un comercio no puede ser sucursal de sí mismo, que es la forma
          // más rápida de que la ficha desaparezca de todos lados.
          .filter((c) => c.id !== propio && c.parent_id == null)
          .map((c) => ({ id: c.id, name: c.name })),
      );
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [comercio]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function guardar() {
    if (!form.name.trim()) return setError('Falta el nombre.');

    setGuardando(true);
    setError('');

    const fila = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      pickup_address: form.pickup_address.trim() || null,
      pickup_extra: form.pickup_extra.trim() || null,
      pickup_notes: form.pickup_notes.trim() || null,
      pickup_window: form.pickup_window.trim() || null,
      lat: form.lat,
      lng: form.lng,
      active: form.active,
      parent_id: form.parent_id,
    };

    const escribir = (datos: Record<string, unknown>) =>
      esNuevo
        ? supabase.from('clients').insert(datos)
        : supabase
            .from('clients')
            .update(datos)
            .eq('id', (comercio as Comercio).id);

    let { error: e } = await escribir(fila);

    /*
     * Si todavía no se corrió el paso 50, la columna `parent_id` no existe y la
     * base rechaza el guardado entero. Ahí se guarda sin ella.
     *
     * Es por la ventana entre publicar la app y correr el paso a mano: sin esto,
     * en ese rato no se podría corregir NINGÚN comercio, ni la dirección ni el
     * horario. Perder lo de sucursales un rato es molesto; no poder guardar es
     * quedarse sin la pantalla.
     */
    if (e && /parent_id/.test(e.message)) {
      const { parent_id, ...sinSucursal } = fila;
      void parent_id;
      ({ error: e } = await escribir(sinSucursal));
    }

    setGuardando(false);

    if (e) {
      // El nombre es único (paso 40): repetirlo es el error más probable acá.
      setError(
        e.message.includes('clients_nombre_unico')
          ? 'Ya existe un comercio con ese nombre.'
          : e.message,
      );
      return;
    }

    onGuardado();
  }

  async function borrar() {
    setGuardando(true);
    setError('');
    const r = await borrarComercio(comercio as Comercio);
    setGuardando(false);

    if (r === null) return; // lo pensó mejor
    if (r.error) return setError(r.error);
    (onBorrado ?? onGuardado)();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--edr-border)] bg-[var(--edr-surface-2)] p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-lg font-black">{esNuevo ? 'Nuevo comercio' : form.name}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="px-2 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Nombre</label>
            <input
              className={campo}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Toy Piola"
            />
          </div>

          <div>
            <label className={labelCls}>Dirección de retiro</label>
            <input
              className={campo}
              value={form.pickup_address}
              onChange={(e) => set('pickup_address', e.target.value)}
              placeholder="Independencia 2684"
            />
          </div>

          <div>
            <label className={labelCls}>Piso / depto / local</label>
            <input
              className={campo}
              value={form.pickup_extra}
              onChange={(e) => set('pickup_extra', e.target.value)}
              placeholder="5A · piso 2 · local 3"
            />
            <p className="mt-1 text-[11px] text-[var(--edr-muted)]">
              Va acá y no pegado a la dirección: el buscador no entiende &quot;Belgrano 2875 5A&quot;
              y no encuentra el punto.
            </p>
          </div>

          <div>
            <label className={labelCls}>Horario de retiro</label>
            <input
              className={campo}
              value={form.pickup_window}
              onChange={(e) => set('pickup_window', e.target.value)}
              placeholder="9 a 18 hs"
            />
            {/* Es el horario del LOCAL, no el de la entrega. Con esto cargado,
                el panel avisa cuando el comercio está por cerrar y todavía hay
                paquetes ahí, y al repartidor le aparece "pasá a retirar". Sin
                cargar no salta nada: no se adivina a qué hora cierra. */}
            <p className="mt-1 text-[11px] leading-snug text-[var(--edr-muted)]">
              Hasta qué hora este comercio entrega los paquetes. Se avisa cuando está por cerrar y
              todavía queda algo sin retirar. Se puede escribir como venga: &quot;9 a 18 hs&quot;,
              &quot;hasta las 13&quot;.
            </p>
          </div>

          <div>
            <label className={labelCls}>Notas de retiro</label>
            <input
              className={campo}
              value={form.pickup_notes}
              onChange={(e) => set('pickup_notes', e.target.value)}
              placeholder="Tocar timbre del local · preguntar por Marce"
            />
          </div>

          <div>
            <label className={labelCls}>Teléfono</label>
            <input
              className={campo}
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>

          {/*
            Sucursales.

            Cada local es su propia ficha porque cada local tiene su dirección,
            su punto en el mapa y su horario: son cosas distintas y el
            repartidor las trata distinto. Lo que esto agrega es a quién
            pertenece, y con eso el dueño entra una sola vez al portal y ve los
            envíos de todos sus locales juntos.
          */}
          <div>
            <label className={labelCls}>¿Es sucursal de otro comercio?</label>
            <select
              className={campo}
              value={form.parent_id ?? ''}
              onChange={(e) => set('parent_id', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">No, es un comercio por su cuenta</option>
              {centrales.map((c) => (
                <option key={c.id} value={c.id}>
                  Sucursal de {c.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] leading-snug text-[var(--edr-muted)]">
              Para los que tienen más de un local. Cada sucursal guarda su propia
              dirección, su punto y su horario; el dueño entra una sola vez al portal y ve los
              envíos de todos sus locales.
            </p>
          </div>

          {/*
            El punto, con el mismo verificador que se usa al cargar un envío.

            No alcanza con buscar la dirección y guardar lo que salga: acá el
            punto se mira. Un comercio mal ubicado manda al repartidor a otra
            cuadra todos los días, y a diferencia de un envío suelto ese error
            se repite en cada retiro hasta que alguien lo note.
          */}
          <div>
            <label className={labelCls}>Dónde queda</label>
            <VerificarPunto
              direccion={form.pickup_address}
              ciudad="Mar del Plata"
              lat={form.lat}
              lng={form.lng}
              onPunto={(punto) => {
                set('lat', punto?.lat ?? null);
                set('lng', punto?.lng ?? null);
              }}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Activo
            <span className="text-xs text-[var(--edr-muted)]">
              (los inactivos no aparecen al cargar un envío)
            </span>
          </label>

          {error && (
            <div className="rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
              {error}
            </div>
          )}

          <button
            onClick={guardar}
            disabled={guardando}
            className="w-full rounded-full bg-[var(--edr-yellow)] px-4 py-3 font-black text-[var(--edr-blue)] disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>

          {/* Borrar va abajo, sin color y chico: es lo que menos se hace de
              esta pantalla, y un botón rojo grande al lado de "Guardar" se
              termina tocando por error. */}
          {!esNuevo && (
            <button
              onClick={borrar}
              disabled={guardando}
              className="mx-auto text-xs font-bold text-[var(--edr-muted)] underline underline-offset-4 disabled:opacity-60"
            >
              Borrar este comercio
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
