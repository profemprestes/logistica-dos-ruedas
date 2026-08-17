'use client';

/**
 * Los comercios de donde se retira.
 *
 * Existe por dos cosas concretas. Una: cargar un envío deja de ser escribir la
 * dirección de retiro a mano cada vez —con 33 envíos de un mismo comercio eso
 * es escribirla 33 veces, y que en algunas quede distinta—. La otra: acá vive
 * el punto del comercio, que es lo que le faltaba al mapa para poder dibujar
 * dónde hay que ir a retirar en vez de dónde hay que entregar.
 *
 * Los comercios nacen solos al cargar un envío con un nombre nuevo. Esta
 * pantalla es para MIRARLOS Y CORREGIRLOS, no para dar de alta antes de poder
 * trabajar. Si obligara a eso, sería una traba en el camino de lo único que
 * importa, que es cargar el envío.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { Search } from 'lucide-react';
import VerificarPunto from '@/components/admin/VerificarPunto';

interface Comercio {
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
  lat: number | null;
  lng: number | null;
  active: boolean;
}

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

const VACIO: Omit<Comercio, 'id'> = {
  name: '',
  phone: null,
  pickup_address: null,
  pickup_extra: null,
  pickup_notes: null,
  lat: null,
  lng: null,
  active: true,
};

export default function ComerciosPage() {
  const ready = useAdminGuard();
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [envios, setEnvios] = useState<Map<number, number>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [editando, setEditando] = useState<Comercio | Omit<Comercio, 'id'> | null>(null);
  const [error, setError] = useState('');

  /*
   * Un número que sube para pedir de nuevo la lista.
   *
   * Es la forma de que guardar un comercio recargue la pantalla sin sacar la
   * consulta afuera del efecto: la regla del compilador de React no deja llamar
   * a setState desde el cuerpo de un efecto, y la consulta tiene que vivir
   * adentro para poder cancelarse si la pantalla se cierra mientras viaja.
   */
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    const traer = async () => {
      const [{ data, error: e }, { data: usos }] = await Promise.all([
        supabase.from('clients').select('*').order('name'),
        // Cuántos envíos tiene cada uno: es lo que dice si un comercio importa
        // o si fue un retiro suelto de una vez.
        supabase.from('shipments').select('client_id').not('client_id', 'is', null).limit(2000),
      ]);

      if (!vivo) return;

      if (e) setError(e.message);
      else setComercios((data ?? []) as Comercio[]);

      const cuenta = new Map<number, number>();
      for (const s of usos ?? []) {
        const id = (s as { client_id: number }).client_id;
        cuenta.set(id, (cuenta.get(id) ?? 0) + 1);
      }
      setEnvios(cuenta);
      setCargando(false);
    };

    void traer();

    return () => {
      vivo = false;
    };
  }, [ready, version]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = q
      ? comercios.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.pickup_address ?? '').toLowerCase().includes(q),
        )
      : comercios;

    // Los más usados arriba: es el orden en que se los busca.
    return [...lista].sort((a, b) => (envios.get(b.id) ?? 0) - (envios.get(a.id) ?? 0));
  }, [comercios, busqueda, envios]);

  const sinPunto = comercios.filter((c) => c.lat == null).length;

  if (!ready) return null;

  return (
    <div className="min-h-full bg-[var(--edr-paper)]">
      <main className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-black sm:text-2xl">Comercios</h2>
          <button
            onClick={() => setEditando({ ...VACIO })}
            className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)]"
          >
            + Nuevo comercio
          </button>
        </div>

        <p className="mb-3 text-sm text-[var(--edr-muted)]">
          Se crean solos al cargar un envío con un comercio nuevo. Acá se corrigen.
          {sinPunto > 0 && (
            <>
              {' '}
              <strong className="text-[var(--edr-naranja-claro)]">
                {sinPunto} sin ubicar
              </strong>
              : el mapa no los puede dibujar hasta que tengan punto.
            </>
          )}
        </p>

        <div className="relative mb-3">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--edr-muted)]"
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o dirección"
            className={`${campo} pl-9`}
          />
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {cargando ? (
          <p className="text-sm text-[var(--edr-muted)]">Cargando…</p>
        ) : visibles.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--edr-border)] px-4 py-8 text-center text-sm text-[var(--edr-muted)]">
            {busqueda ? 'Ningún comercio con ese nombre.' : 'Todavía no hay comercios cargados.'}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {visibles.map((c) => (
              <button
                key={c.id}
                onClick={() => setEditando(c)}
                className="flex items-start justify-between gap-3 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 text-left hover:border-[var(--edr-acento)]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{c.name}</span>
                    {!c.active && (
                      <span className="rounded bg-[var(--edr-surface-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-muted)]">
                        inactivo
                      </span>
                    )}
                    {c.lat == null && (
                      <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-naranja-claro)]">
                        sin ubicar
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-[var(--edr-muted)]">
                    {c.pickup_address || 'sin dirección de retiro'}
                    {c.pickup_extra ? ` · ${c.pickup_extra}` : ''}
                    {c.pickup_notes ? ` · ${c.pickup_notes}` : ''}
                  </div>
                </div>

                <span className="shrink-0 text-right text-xs text-[var(--edr-muted)]">
                  <span className="edr-mono block text-base font-black text-[var(--edr-acento)]">
                    {envios.get(c.id) ?? 0}
                  </span>
                  envíos
                </span>
              </button>
            ))}
          </div>
        )}
      </main>

      {editando && (
        <Editar
          comercio={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

/** El cuadro de alta y edición. Uno solo para las dos cosas: son los mismos campos. */
function Editar({
  comercio,
  onCerrar,
  onGuardado,
}: {
  comercio: Comercio | Omit<Comercio, 'id'>;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const esNuevo = !('id' in comercio);
  const [form, setForm] = useState({
    name: comercio.name,
    phone: comercio.phone ?? '',
    pickup_address: comercio.pickup_address ?? '',
    pickup_extra: comercio.pickup_extra ?? '',
    pickup_notes: comercio.pickup_notes ?? '',
    lat: comercio.lat,
    lng: comercio.lng,
    active: comercio.active,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

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
      lat: form.lat,
      lng: form.lng,
      active: form.active,
    };

    const { error: e } = esNuevo
      ? await supabase.from('clients').insert(fila)
      : await supabase.from('clients').update(fila).eq('id', (comercio as Comercio).id);

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

  /**
   * Borrar el comercio de la lista.
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
  async function borrar() {
    const id = (comercio as Comercio).id;

    const { count } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', id);

    const cuantos = count ?? 0;
    const aviso =
      cuantos > 0
        ? `¿Borrar ${form.name}?\n\nEstá en ${cuantos} envío(s). Esos envíos NO se borran y siguen mostrando "${form.name}" y su dirección: lo único que se pierde es el punto guardado para el mapa.`
        : `¿Borrar ${form.name}? No hay ningún envío que lo use.`;

    if (!confirm(aviso)) return;

    setGuardando(true);
    setError('');

    const { error: e } = await supabase.from('clients').delete().eq('id', id);

    setGuardando(false);

    if (e) {
      setError(e.message);
      return;
    }

    onGuardado();
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
              Va acá y no pegado a la dirección: el buscador no entiende
              &quot;Belgrano 2875 5A&quot; y no encuentra el punto.
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
