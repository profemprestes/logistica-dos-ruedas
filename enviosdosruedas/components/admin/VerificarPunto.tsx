'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { encolarBusqueda } from '@/lib/colaGeocode';
import { dentroDeLaCaja, parsearPunto, textoPunto, type Punto } from '@/lib/punto';

/** Leaflet toca `window` al cargar: nunca en el servidor. */
const MapaElegible = dynamic(() => import('@/components/admin/MapaElegible'), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 items-center justify-center rounded border border-dashed border-[var(--edr-border)] text-xs text-[var(--edr-muted)]">
      Abriendo el mapa…
    </div>
  ),
});

/**
 * Ver el punto en el mapa antes de guardar el envío.
 *
 * Existe por las direcciones sucias. "AV DORREGO 172 PLANTA YPF" no la
 * encuentra ningún buscador, pero "PLANTA YPF Dorrego" sí. La gracia es que
 * son DOS TEXTOS DISTINTOS y no hay que elegir uno:
 *
 *   - La dirección del envío queda como está, con el "PLANTA YPF" que el
 *     repartidor necesita leer.
 *   - Acá se escribe con qué buscarla en el mapa, y eso no se guarda: lo único
 *     que queda es el punto que confirmaste.
 *
 * Es más permisivo que la búsqueda automática —acepta cualquier texto y no
 * exige altura— porque acá hay alguien mirando el mapa. La regla estricta es
 * para cuando nadie mira.
 *
 * Y cuando no lo encuentra ni buscándolo, está el modo a mano: hay direcciones
 * que no existen en ningún buscador (esquinas sin altura, barrios nuevos) y la
 * única fuente confiable es alguien que sabe dónde queda.
 */
export default function VerificarPunto({
  direccion,
  ciudad,
  lat,
  lng,
  onPunto,
}: {
  direccion: string;
  ciudad: string;
  lat: number | null;
  lng: number | null;
  onPunto: (p: Punto | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [encontrado, setEncontrado] = useState<{
    lat: number;
    lng: number;
    etiqueta: string;
    exacta: boolean;
  } | null>(null);
  const [aviso, setAviso] = useState('');
  /** Modo a mano: el mapa de verdad, donde se toca para poner el punto. */
  const [aMano, setAMano] = useState(false);
  const [elegido, setElegido] = useState<Punto | null>(null);
  /** Cómo salió la búsqueda automática, para contarlo en una línea. */
  const [solo, setSolo] = useState<'buscando' | 'puesto' | 'dudoso' | 'nada' | null>(null);

  /*
   * BUSCAR SOLO, SIN QUE NADIE TOQUE NADA.
   *
   * Antes el punto se buscaba recién DESPUÉS de guardar, en segundo plano. Al
   * que cargaba el envío eso no se le veía: el formulario decía "sin punto", y
   * lo natural era abrir el mapa y ponerlo a mano. Tres clics por envío para
   * un punto que en tres de cada cuatro casos el buscador iba a encontrar solo
   * un minuto después. Eso es lo que hacía sentir que todo era manual.
   *
   * Ahora se busca mientras se carga y, si el resultado es una puerta con
   * altura, se usa directamente. Sólo hay que intervenir cuando abajo dice que
   * no lo encontró o que quedó dudoso.
   *
   * `onPunto` va por un ref porque el padre lo pasa como función nueva en cada
   * render: metido en las dependencias, esto se repetiría para siempre.
   */
  const onPuntoRef = useRef(onPunto);
  useEffect(() => {
    onPuntoRef.current = onPunto;
  }, [onPunto]);

  /** Direcciones que ya se intentaron: una sola vez cada una. */
  const intentadas = useRef(new Set<string>());

  useEffect(() => {
    const dir = (direccion ?? '').trim();

    // Con punto puesto no hay nada que buscar, y una dirección a medio escribir
    // tampoco: se espera a que tenga forma de dirección.
    if (lat != null || dir.length < 6) return;

    const clave = `${dir}|${ciudad ?? ''}`;
    if (intentadas.current.has(clave)) return;

    // Un respiro por si sigue tecleando: sin esto, "ALBERTI 27" se busca antes
    // de que termine de escribir "ALBERTI 2791".
    const t = setTimeout(() => {
      if (intentadas.current.has(clave)) return;
      intentadas.current.add(clave);
      setSolo('buscando');

      void encolarBusqueda(async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const res = await fetch('/api/geocode', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${data.session?.access_token ?? ''}`,
            },
            body: JSON.stringify({ consulta: dir, ciudad }),
          });

          const json = (await res.json()) as {
            origen?: 'memoria' | 'buscador';
            punto?: { lat: number; lng: number; etiqueta: string; exacta: boolean };
          };

          if (!res.ok || !json.punto) {
            setSolo('nada');
            return { origen: json?.origen };
          }

          setEncontrado(json.punto);

          if (json.punto.exacta) {
            // Con altura, el punto cae en la puerta: se usa y listo.
            setElegido({ lat: json.punto.lat, lng: json.punto.lng });
            onPuntoRef.current({ lat: json.punto.lat, lng: json.punto.lng });
            setSolo('puesto');
          } else {
            // Sin altura puede estar a varias cuadras. Se muestra pero NO se
            // usa: que lo mire alguien.
            setSolo('dudoso');
          }

          return { origen: json.origen };
        } catch {
          setSolo('nada');
          return {};
        }
      });
    }, 700);

    return () => clearTimeout(t);
  }, [direccion, ciudad, lat]);

  async function buscar() {
    const consulta = (texto.trim() || direccion).trim();
    if (consulta.length < 3) return setAviso('Escribí algo para buscar.');

    // Coordenadas pegadas, o un link de Google Maps: no hay nada que buscar,
    // el punto ya vino escrito.
    const pegado = parsearPunto(consulta);
    if (pegado) {
      setEncontrado({
        ...pegado,
        etiqueta: `Coordenadas: ${textoPunto(pegado)}`,
        exacta: true,
      });
      setElegido(pegado);
      setAviso(
        dentroDeLaCaja(pegado) ? '' : 'Ojo: ese punto cae lejos de Mar del Plata. Miralo en el mapa.',
      );
      return;
    }

    setBuscando(true);
    setAviso('');
    setEncontrado(null);

    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ consulta, ciudad }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'No se pudo buscar.');

      if (!json.punto) {
        setAviso(
          'No lo encontré. Probá con una referencia conocida, o ponelo a mano tocando el mapa.',
        );
        return;
      }
      setEncontrado(json.punto);
      setElegido({ lat: json.punto.lat, lng: json.punto.lng });
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo buscar.');
    } finally {
      setBuscando(false);
    }
  }

  /** El que se va a usar: lo elegido a mano manda sobre lo buscado. */
  const punto: Punto | null =
    elegido ?? encontrado ?? (lat != null && lng != null ? { lat, lng } : null);

  const d = 0.004;

  return (
    <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setAbierto((v) => !v);
            if (!abierto && !punto) void buscar();
          }}
          className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-bold hover:bg-[var(--edr-surface)]"
        >
          📍 {abierto ? 'Ocultar mapa' : 'Ver el punto en el mapa'}
        </button>

        {lat != null && lng != null && (
          <span className="rounded bg-emerald-950 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-200 ring-1 ring-emerald-400">
            Punto confirmado
          </span>
        )}
        {lat != null && solo === 'puesto' && (
          <span className="text-[11px] text-[var(--edr-muted)]">Lo ubicó solo.</span>
        )}
        {lat == null && solo === 'buscando' && (
          <span className="text-[11px] text-[var(--edr-muted)]">Buscando el punto…</span>
        )}
        {lat == null && solo === 'dudoso' && (
          <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-100 ring-1 ring-amber-400">
            Encontró la calle, no la altura — miralo
          </span>
        )}
        {lat == null && solo === 'nada' && (
          <span className="rounded bg-amber-950 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-100 ring-1 ring-amber-400">
            No lo encontró — ponelo a mano
          </span>
        )}
        {lat == null && !solo && (
          <span className="text-[11px] text-[var(--edr-muted)]">
            Si no lo confirmás, se busca solo al guardar.
          </span>
        )}
      </div>

      {abierto && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void buscar();
                }
              }}
              placeholder={direccion || 'calle y altura, referencia, o coordenadas'}
              className="min-w-0 flex-1 rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--edr-yellow)]"
            />
            <button
              type="button"
              onClick={buscar}
              disabled={buscando}
              className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--edr-surface)] disabled:opacity-50"
            >
              {buscando ? 'Buscando…' : 'Buscar'}
            </button>
            <button
              type="button"
              onClick={() => setAMano((v) => !v)}
              className={`rounded px-3 py-1.5 text-xs font-bold ${
                aMano
                  ? 'bg-[var(--edr-yellow)] text-black'
                  : 'border border-[var(--edr-border)] hover:bg-[var(--edr-surface)]'
              }`}
            >
              ✏️ {aMano ? 'Listo, cerrar el mapa' : 'Ponerlo a mano'}
            </button>
          </div>

          <p className="text-[11px] text-[var(--edr-muted)]">
            Vacío busca la dirección del envío. También podés pegar coordenadas o un link de
            Google Maps. Este texto no se guarda: sirve sólo para encontrar el punto.
          </p>

          {aviso && (
            <p className="rounded border border-amber-400 bg-amber-950 px-2 py-1.5 text-xs text-amber-100">
              {aviso}
            </p>
          )}

          {aMano ? (
            <>
              <p className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2 py-1.5 text-xs">
                Tocá el mapa donde está la puerta, o arrastrá el punto amarillo. Movelo y
                agrandalo como en cualquier mapa hasta encontrar el lugar.
              </p>

              <MapaElegible punto={punto} onElegir={setElegido} />

              {elegido && (
                <p className="edr-mono text-[11px] text-[var(--edr-muted)]">
                  {textoPunto(elegido)}
                </p>
              )}
            </>
          ) : (
            punto && (
              <>
                {encontrado?.etiqueta && (
                  <p className="text-xs text-[var(--edr-muted)]">
                    Encontró: <span className="font-semibold">{encontrado.etiqueta}</span>
                  </p>
                )}

                {/* Sin altura el pin cae en cualquier punto de la calle. Leyendo
                    la etiqueta no se nota, y en una avenida larga son kilómetros. */}
                {encontrado && !encontrado.exacta && (
                  <p className="rounded border border-amber-400 bg-amber-950 px-2 py-1.5 text-xs text-amber-100">
                    Ubicó la calle pero <strong>no la altura</strong>: el punto es aproximado y
                    puede estar a varias cuadras. Mirá el mapa antes de usarlo.
                  </p>
                )}
                <iframe
                  title="Punto de entrega"
                  loading="lazy"
                  src={
                    `https://www.openstreetmap.org/export/embed.html` +
                    `?bbox=${punto.lng - d}%2C${punto.lat - d}%2C${punto.lng + d}%2C${punto.lat + d}` +
                    `&layer=mapnik&marker=${punto.lat}%2C${punto.lng}`
                  }
                  className="h-56 w-full rounded border border-[var(--edr-border)]"
                />
              </>
            )
          )}

          {(punto || lat != null) && (
            <div className="flex flex-wrap gap-2">
              {punto && (punto.lat !== lat || punto.lng !== lng) && (
                <button
                  type="button"
                  onClick={() => {
                    onPunto(punto);
                    setAviso('');
                  }}
                  className="rounded bg-[var(--edr-yellow)] px-3 py-1.5 text-xs font-black text-black hover:brightness-95"
                >
                  ✓ Usar este punto
                </button>
              )}
              {lat != null && (
                <button
                  type="button"
                  onClick={() => {
                    onPunto(null);
                    setEncontrado(null);
                    setElegido(null);
                  }}
                  className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--edr-surface)]"
                >
                  Borrar el punto
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
