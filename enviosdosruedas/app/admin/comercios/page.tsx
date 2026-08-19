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
 *
 * Tocar uno abre SU pantalla, y no un cuadrito con la dirección. Un comercio
 * dejó de ser una dirección de retiro: tiene sus envíos, su acceso al portal y
 * su ficha, y eso no entra en un cuadro.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { KeyRound, Search } from 'lucide-react';
import EditarComercio, { VACIO, borrarComercio, type Comercio } from '@/components/admin/EditarComercio';

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';

export default function ComerciosPage() {
  const ready = useAdminGuard();
  const router = useRouter();
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [envios, setEnvios] = useState<Map<number, number>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [nuevo, setNuevo] = useState<Omit<Comercio, 'id'> | null>(null);
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
  const conAcceso = comercios.filter((c) => c.profile_id).length;

  if (!ready) return null;

  return (
    <div className="min-h-full bg-[var(--edr-paper)]">
      <main className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-black sm:text-2xl">Comercios</h2>
          <button
            onClick={() => setNuevo({ ...VACIO })}
            className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)]"
          >
            + Nuevo comercio
          </button>
        </div>

        <p className="mb-3 text-sm text-[var(--edr-muted)]">
          Tocá uno para ver sus envíos, su acceso al portal y su ficha.
          {sinPunto > 0 && (
            <>
              {' '}
              <strong className="text-[var(--edr-naranja-claro)]">{sinPunto} sin ubicar</strong>: el
              mapa no los puede dibujar hasta que tengan punto.
            </>
          )}
          {conAcceso > 0 && <> · {conAcceso} con acceso al portal.</>}
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
              /* La fila era un botón entero. Ahora el botón es sólo la parte
                 que abre el comercio, porque adentro de un botón no puede ir
                 otro: el de borrar quedaría inservible. */
              <div
                key={c.id}
                className="flex items-start gap-2 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 hover:border-[var(--edr-acento)]"
              >
                <button
                  onClick={() => router.push(`/admin/comercios/${c.id}`)}
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 text-left"
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
                      {c.profile_id && (
                        <span
                          title="Puede entrar a ver sus envíos"
                          className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-verde-claro)]"
                        >
                          <KeyRound size={10} /> entra
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

                {/* Borrar, acá y no sólo adentro de la ficha: ahí quedaba
                    abajo del mapa y había que scrollear para encontrarlo. */}
                <button
                  onClick={async () => {
                    const r = await borrarComercio(c);
                    if (r === null) return;
                    if (r.error) return setError(r.error);
                    setVersion((v) => v + 1);
                  }}
                  aria-label={`Borrar ${c.name}`}
                  title="Borrar este comercio"
                  className="shrink-0 self-center rounded-full border border-[var(--edr-border)] px-2.5 py-1.5 text-xs font-bold text-[var(--edr-muted)] hover:border-[var(--edr-rojo)] hover:text-[var(--edr-rojo-claro)]"
                >
                  Borrar
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

      {nuevo && (
        <EditarComercio
          comercio={nuevo}
          onCerrar={() => setNuevo(null)}
          onGuardado={() => {
            setNuevo(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
