'use client';

/**
 * Mandar a alguien a retirar a un comercio.
 *
 * Es la contraparte de la pantalla del repartidor: acá se crea la instrucción
 * que allá aparece arriba de la hoja de ruta. Ver el paso 39 para el porqué de
 * que esto no sea un envío.
 *
 * La dirección es texto libre y va a seguir siéndolo un tiempo: los comercios
 * todavía no son una tabla, y esperar a que lo sean sería no tener esto. Lo que
 * sí se hace es recordar las últimas usadas, que en los hechos son casi todas
 * —seis comercios explican la mayoría de los envíos— así que en la práctica se
 * elige de una lista aunque por dentro sea texto.
 */
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { hoyLocal } from '@/lib/scheduled';
import type { Shipment } from '@/lib/format';

interface Driver {
  id: string;
  full_name: string;
}

const campo =
  'w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/** Un comercio conocido, sacado de los envíos que ya se cargaron. */
interface Conocido {
  direccion: string;
  comercio: string;
}

export default function MandarColecta({
  drivers,
  envios,
  onCerrar,
  onHecha,
}: {
  drivers: Driver[];
  /** Los envíos que ya están en pantalla: de ahí salen los comercios conocidos. */
  envios: Shipment[];
  onCerrar: () => void;
  onHecha: () => void;
}) {
  /*
   * Con un solo repartidor queda elegido de entrada: hacerlo elegir entre uno
   * es un toque de más. Se resuelve al crear el estado y no en un efecto,
   * porque para cuando este cuadro se dibuja la lista ya está cargada.
   */
  const [driverId, setDriverId] = useState(() => (drivers.length === 1 ? drivers[0].id : ''));
  const [direccion, setDireccion] = useState('');
  const [comercio, setComercio] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  /**
   * Los comercios que aparecen en los envíos cargados, de más usado a menos.
   *
   * Es la lista que se ofrece para elegir. No es una tabla de clientes ni
   * pretende serlo: es lo que ya se escribió antes, para no volver a escribirlo.
   */
  const conocidos = useMemo(() => {
    const cuenta = new Map<string, { c: Conocido; n: number }>();

    for (const s of envios) {
      const dir = (s.pickup_address ?? '').trim();
      if (!dir) continue;
      const clave = dir.toLowerCase();
      const previo = cuenta.get(clave);
      cuenta.set(clave, {
        c: { direccion: dir, comercio: previo?.c.comercio || (s.client_name_raw ?? '').trim() },
        n: (previo?.n ?? 0) + 1,
      });
    }

    return [...cuenta.values()].sort((a, b) => b.n - a.n).map((x) => x.c);
  }, [envios]);

  async function guardar() {
    if (!driverId) return setError('Elegí a quién mandar.');
    if (!direccion.trim()) return setError('Falta la dirección de retiro.');

    setGuardando(true);
    setError('');

    const { data: sesion } = await supabase.auth.getSession();

    /*
     * El punto se busca acá y no en la base, aprovechando el geocodificador que
     * ya usa el panel. Si no lo encuentra la colecta se crea igual, sin punto:
     * hay direcciones que no geocodifican —"BASE", "TERMINAL PLUSMAR"— y eso no
     * puede impedir mandar a alguien a retirar.
     */
    let lat: number | null = null;
    let lng: number | null = null;

    try {
      const r = await fetch('/api/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sesion.session?.access_token ?? ''}`,
        },
        // Modo verificación: busca y devuelve el punto sin guardar nada.
        body: JSON.stringify({ consulta: direccion.trim(), ciudad: 'Mar del Plata' }),
      });

      if (r.ok) {
        const { punto } = (await r.json()) as { punto?: { lat: number; lng: number } | null };
        if (punto) {
          lat = punto.lat;
          lng = punto.lng;
        }
      }
    } catch {
      // Sin punto se crea igual. El "cómo llegar" usa la dirección escrita.
    }

    const { error: e } = await supabase.from('colectas').insert({
      driver_id: driverId,
      direccion: direccion.trim(),
      comercio: comercio.trim() || null,
      nota: nota.trim() || null,
      lat,
      lng,
      fecha: hoyLocal(),
      creada_por: sesion.session?.user?.id ?? null,
    });

    setGuardando(false);

    if (e) {
      setError(e.message);
      return;
    }

    onHecha();
    onCerrar();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
      <div className="w-full max-w-lg rounded-t-2xl border border-[var(--edr-border)] bg-[var(--edr-surface-2)] p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black">Mandar a retirar</h2>
            <p className="text-xs text-[var(--edr-muted)]">
              Le aparece arriba de la hoja de ruta, con el cómo llegar.
            </p>
          </div>
          <button onClick={onCerrar} aria-label="Cerrar" className="px-2 text-2xl leading-none">
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>Quién va</label>
            <select
              className={campo}
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">Elegir…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </div>

          {conocidos.length > 0 && (
            <div>
              <label className={labelCls}>Comercios que ya usaste</label>
              <select
                className={campo}
                defaultValue=""
                onChange={(e) => {
                  const c = conocidos[Number(e.target.value)];
                  if (!c) return;
                  setDireccion(c.direccion);
                  setComercio(c.comercio);
                }}
              >
                <option value="">Elegir uno…</option>
                {conocidos.map((c, i) => (
                  <option key={c.direccion} value={i}>
                    {c.comercio ? `${c.comercio} · ` : ''}
                    {c.direccion}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Dirección de retiro</label>
            <input
              className={campo}
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              placeholder="Independencia 2684"
            />
          </div>

          <div>
            <label className={labelCls}>Comercio (opcional)</label>
            <input
              className={campo}
              value={comercio}
              onChange={(e) => setComercio(e.target.value)}
              placeholder="Toy Piola"
            />
          </div>

          <div>
            <label className={labelCls}>Nota (opcional)</label>
            <input
              className={campo}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="3 paquetes · pasar después de las 14"
            />
          </div>

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
            {guardando ? 'Mandando…' : 'Mandar'}
          </button>
        </div>
      </div>
    </div>
  );
}
