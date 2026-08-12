'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

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
  onPunto: (p: { lat: number; lng: number } | null) => void;
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

  async function buscar() {
    const consulta = (texto.trim() || direccion).trim();
    if (consulta.length < 3) return setAviso('Escribí algo para buscar.');

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
        setAviso('No lo encontré. Probá con la calle y la altura sueltas, o con una referencia conocida.');
        return;
      }
      setEncontrado(json.punto);
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo buscar.');
    } finally {
      setBuscando(false);
    }
  }

  const punto = encontrado ?? (lat != null && lng != null ? { lat, lng, etiqueta: '' } : null);
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
        {lat == null && (
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
              placeholder={direccion || 'calle y altura, o una referencia'}
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
          </div>

          <p className="text-[11px] text-[var(--edr-muted)]">
            Vacío busca la dirección del envío. Este texto no se guarda: sirve sólo para
            encontrar el punto.
          </p>

          {aviso && (
            <p className="rounded border border-amber-400 bg-amber-950 px-2 py-1.5 text-xs text-amber-100">
              {aviso}
            </p>
          )}

          {punto && (
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

              <div className="flex flex-wrap gap-2">
                {encontrado && (
                  <button
                    type="button"
                    onClick={() => {
                      onPunto({ lat: encontrado.lat, lng: encontrado.lng });
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
                    }}
                    className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--edr-surface)]"
                  >
                    Borrar el punto
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
