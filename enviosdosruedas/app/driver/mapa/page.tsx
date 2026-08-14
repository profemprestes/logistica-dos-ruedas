'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { readCachedRoute } from '@/lib/driver/db';
import { getFix, type Fix } from '@/lib/driver/geo';
import { useOnline } from '@/lib/driver/useOnline';
import { partirRuta } from '@/lib/scheduled';
import { marcaDeEstado, STATUS_LABEL, type Shipment } from '@/lib/format';
import type { PuntoMapa } from '@/components/MapaEnvios';

const MapaEnvios = dynamic(() => import('@/components/MapaEnvios'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[65vh] items-center justify-center rounded-lg border border-dashed border-[var(--edr-border)] text-sm font-bold text-[var(--edr-muted)]">
      Abriendo el mapa…
    </div>
  ),
});

/** Los que todavía se reparten: el mapa es para llegar, no para repasar. */
const ACTIVOS = ['creado', 'pendiente_retiro', 'retirado', 'en_camino'];

/**
 * La hoja de ruta del día sobre un mapa.
 *
 * Para lo que la lista no sirve: ver de una si las entregas están todas en el
 * mismo barrio o hay que cruzar la ciudad, y armar el orden antes de arrancar.
 *
 * Se apoya en el caché de IndexedDB igual que la hoja de ruta, así que los
 * puntos aparecen aunque no haya señal. Las baldosas del mapa no: esas vienen
 * de internet y sin señal quedan en blanco. Por eso el aviso de arriba.
 */
export default function MapaRepartidorPage() {
  const online = useOnline();
  const [envios, setEnvios] = useState<Shipment[]>([]);
  const [cargando, setCargando] = useState(true);
  const [yo, setYo] = useState<Fix | null>(null);
  const [elegido, setElegido] = useState<Shipment | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id;

      if (id) {
        const { data: filas } = await supabase
          .from('shipments')
          .select('*')
          .eq('assigned_driver', id)
          // El intento fallido que ya se reprogramó no va: el que hay que
          // llegar es el envío nuevo, y dos puntos en la misma puerta confunden.
          .is('reprogramado_en', null)
          .in('status', ACTIVOS)
          .order('id');

        if (filas && vivo) {
          setEnvios(filas as Shipment[]);
          setCargando(false);
          return;
        }
      }

      // Sin señal o sin sesión fresca: lo que quedó guardado en el celular.
      const cache = await readCachedRoute();
      if (vivo) {
        setEnvios(cache);
        setCargando(false);
      }
    })();

    getFix().then((f) => {
      if (vivo) setYo(f);
    });

    return () => {
      vivo = false;
    };
  }, []);

  // Los programados para otro día no van: hoy no se tocan, y en el mapa sólo
  // ensucian el recorrido de la jornada.
  const deHoy = useMemo(() => partirRuta(envios).deHoy, [envios]);

  const conPunto = useMemo(
    () => deHoy.filter((s) => s.lat != null && s.lng != null),
    [deHoy],
  );
  const sinPunto = deHoy.length - conPunto.length;

  const puntos: PuntoMapa[] = useMemo(
    () =>
      conPunto.map((s) => {
        const marca = marcaDeEstado(s.status);
        return {
          id: s.id,
          lat: Number(s.lat),
          lng: Number(s.lng),
          etiqueta: marca.simbolo,
          color: marca.color,
          colorTexto: marca.colorTexto,
          titulo: s.address_street,
          detalle: `${s.recipient_name} · ${STATUS_LABEL[s.status]}`,
        };
      }),
    [conPunto],
  );

  return (
    <div className="min-h-dvh pb-8">
      <header className="bg-[var(--edr-surface-2)] px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-black leading-tight">Mapa del día</h1>
            <p className="text-xs text-white/70">
              {cargando ? 'Cargando…' : `${conPunto.length} de ${deHoy.length} en el mapa`}
            </p>
          </div>
          <Link
            href="/driver/dashboard"
            className="shrink-0 rounded-lg bg-white/15 px-4 py-2 text-sm font-bold"
          >
            ← Hoja de ruta
          </Link>
        </div>
      </header>

      <div className="space-y-3 px-3 py-3">
        {!online && (
          <p className="rounded-xl bg-amber-400 px-3 py-2 text-center text-sm font-black text-black">
            Sin señal: los puntos están, pero el mapa no se va a dibujar hasta que vuelva.
          </p>
        )}

        {sinPunto > 0 && (
          <p className="rounded-xl border-2 border-[var(--edr-border)] px-3 py-2 text-center text-sm font-bold text-[var(--edr-muted)]">
            {sinPunto} envío(s) sin punto en el mapa. Están en la hoja de ruta con su dirección.
          </p>
        )}

        {!cargando && conPunto.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-lg border-2 border-dashed border-[var(--edr-border)] px-6 text-center text-sm font-bold text-[var(--edr-muted)]">
            {deHoy.length === 0
              ? 'No tenés envíos para hoy.'
              : 'Ninguno de los envíos de hoy tiene punto cargado.'}
          </div>
        ) : (
          <MapaEnvios
            puntos={puntos}
            miUbicacion={yo}
            alto="h-[65vh]"
            onTocar={(id) => setElegido(deHoy.find((s) => s.id === id) ?? null)}
          />
        )}

        {elegido && (
          <div className="rounded-xl border-4 border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xl font-black leading-tight">{elegido.address_street}</div>
                {elegido.address_extra && (
                  <div className="text-base font-bold">{elegido.address_extra}</div>
                )}
                <div className="text-sm text-[var(--edr-muted)]">
                  {elegido.recipient_name} · {STATUS_LABEL[elegido.status]}
                </div>
              </div>
              <button
                onClick={() => setElegido(null)}
                className="shrink-0 rounded px-2 text-3xl leading-none text-[var(--edr-muted)]"
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${elegido.lat},${elegido.lng}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block rounded-xl bg-[var(--edr-blue)] px-4 py-3 text-center text-base font-black text-white"
            >
              🧭 Cómo llegar a destino
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
