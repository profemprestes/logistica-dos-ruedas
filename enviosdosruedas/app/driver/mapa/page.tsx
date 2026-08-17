'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Navigation } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { readCachedRoute } from '@/lib/driver/db';
import { getFix, type Fix } from '@/lib/driver/geo';
import { misColectas, type Colecta } from '@/lib/driver/colectas';
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
/** Un punto del mapa junto con de qué envío salió y por qué está ahí. */
interface PuntoElegido {
  envio: Shipment;
  lat: number | null;
  lng: number | null;
  enElComercio: boolean;
  comercio: string | null;
}

export default function MapaRepartidorPage() {
  const online = useOnline();
  const [envios, setEnvios] = useState<Shipment[]>([]);
  const [cargando, setCargando] = useState(true);
  const [yo, setYo] = useState<Fix | null>(null);
  /**
   * El punto que se tocó, no el envío.
   *
   * Guarda también SI ese punto es el comercio o el destino, que es lo que
   * decide qué mostrar y hacia dónde llevar el "cómo llegar". Con sólo el envío
   * no alcanza: el mismo envío se dibuja en un lugar u otro según si ya lo
   * retiró.
   */
  const [elegido, setElegido] = useState<PuntoElegido | null>(null);
  /**
   * Las colectas pendientes, que son lugares a los que ir SIN envío de por
   * medio. Van al mismo mapa a propósito: el repartidor mira un solo mapa para
   * decidir por dónde arrancar, y una colecta que vive en otra pantalla es una
   * parada que no entra en esa cuenta.
   */
  const [colectas, setColectas] = useState<Colecta[]>([]);

  useEffect(() => {
    let vivo = true;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const id = data.user?.id;

      if (id) {
        const { data: filas } = await supabase
          .from('shipments')
          // El comercio viene con el envío: ahí está el punto de RETIRO, que el
          // envío no tiene. Sin esto el mapa dibuja un paquete sin retirar en la
          // casa del cliente y el "cómo llegar" manda para allá.
          .select('*, comercio:client_id(name, lat, lng)')
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

    void misColectas().then((cs) => {
      if (vivo) setColectas(cs);
    });

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

  /*
   * DÓNDE VA CADA PUNTO, y esto es el arreglo de un error de fondo.
   *
   * Un envío tiene DOS lugares: de dónde se retira y a dónde se entrega. El
   * mapa dibujaba siempre el segundo, incluso para los paquetes que todavía
   * están en el comercio — así que el repartidor cruzaba la ciudad hasta un
   * domicilio a entregar algo que no tenía en la moto.
   *
   * Ahora, mientras no lo retiró, el punto es el del comercio y se pinta en
   * azul oscuro. Cuando lo retira salta solo a la dirección de entrega, con el
   * color de su estado.
   */
  const AZUL_RETIRO = '#1e3a8a';

  const ubicados = useMemo(
    () =>
      deHoy.map((s) => {
        const sinRetirar = s.status === 'creado' || s.status === 'pendiente_retiro';
        const comercio = (s as Shipment & { comercio?: { name: string; lat: number | null; lng: number | null } | null }).comercio;

        if (sinRetirar && comercio?.lat != null && comercio.lng != null) {
          return {
            envio: s,
            lat: Number(comercio.lat),
            lng: Number(comercio.lng),
            enElComercio: true,
            comercio: comercio.name,
          };
        }

        return {
          envio: s,
          lat: s.lat != null ? Number(s.lat) : null,
          lng: s.lng != null ? Number(s.lng) : null,
          enElComercio: false,
          comercio: comercio?.name ?? null,
        };
      }),
    [deHoy],
  );

  const conPunto = useMemo(() => ubicados.filter((u) => u.lat != null), [ubicados]);
  const sinPunto = deHoy.length - conPunto.length;

  const puntos: PuntoMapa[] = useMemo(
    () =>
      conPunto.map((u) => {
        const marca = marcaDeEstado(u.envio.status);
        return {
          id: u.envio.id,
          lat: u.lat as number,
          lng: u.lng as number,
          etiqueta: u.enElComercio ? '↑' : marca.simbolo,
          color: u.enElComercio ? AZUL_RETIRO : marca.color,
          colorTexto: u.enElComercio ? '#fff' : marca.colorTexto,
          titulo: u.enElComercio
            ? `Retirar en ${u.envio.pickup_address ?? u.comercio ?? ''}`
            : u.envio.address_street,
          detalle: u.enElComercio
            ? `${u.comercio ?? 'Comercio'} · ${u.envio.recipient_name}`
            : `${u.envio.recipient_name} · ${STATUS_LABEL[u.envio.status]}`,
        };
      }),
    [conPunto],
  );

  /*
   * Las colectas se dibujan con id NEGATIVO.
   *
   * Los ids de los envíos son positivos, así que tocar una colecta no puede
   * abrir por error la ficha de un envío cualquiera. Es el mismo truco que usa
   * el mapa del panel para las motos.
   */
  const puntosColecta: PuntoMapa[] = useMemo(
    () =>
      colectas
        .filter((c) => c.lat != null && c.lng != null)
        .map((c) => ({
          id: -c.id,
          lat: Number(c.lat),
          lng: Number(c.lng),
          etiqueta: '↑',
          color: AZUL_RETIRO,
          colorTexto: '#fff',
          titulo: `Colecta · ${c.direccion}`,
          detalle: [c.comercio, c.nota].filter(Boolean).join(' · '),
        })),
    [colectas],
  );

  return (
    <div className="pb-6">
      <header className="px-3.5 pt-4">
        <h1 className="font-anton text-[26px] uppercase leading-none tracking-[-.02em] text-white">
          Mapa del día
        </h1>
        <p className="mt-1 font-bebas text-base tracking-[.06em] text-[var(--edr-muted)]">
          {cargando ? 'CARGANDO…' : `${conPunto.length} DE ${deHoy.length} EN EL MAPA`}
        </p>
      </header>

      <div className="space-y-3 px-3.5 py-3">
        {!online && (
          <p className="rounded-2xl bg-[var(--edr-yellow)] px-4 py-2.5 text-center font-bebas text-base tracking-[.05em] text-[var(--edr-blue)]">
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
            puntos={[...puntos, ...puntosColecta]}
            miUbicacion={yo}
            alto="h-[65vh]"
            onTocar={(id) =>
              setElegido(id < 0 ? null : (ubicados.find((u) => u.envio.id === id) ?? null))
            }
          />
        )}

        {elegido && (
          <div className="rounded-xl border-4 border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* Lo primero que se lee tiene que ser a dónde ir AHORA. Para un
                    paquete sin retirar eso es el comercio, no la casa del
                    cliente — que es adonde hay que ir después. */}
                {elegido.enElComercio ? (
                  <>
                    <div className="font-bebas text-base tracking-[.08em] text-[var(--edr-acento)]">
                      RETIRAR EN
                    </div>
                    <div className="text-xl font-black leading-tight">
                      {elegido.envio.pickup_address ?? elegido.comercio}
                    </div>
                    <div className="text-sm text-[var(--edr-muted)]">
                      {elegido.comercio} · después va a {elegido.envio.address_street}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-xl font-black leading-tight">
                      {elegido.envio.address_street}
                    </div>
                    {elegido.envio.address_extra && (
                      <div className="text-base font-bold">{elegido.envio.address_extra}</div>
                    )}
                    <div className="text-sm text-[var(--edr-muted)]">
                      {elegido.envio.recipient_name} · {STATUS_LABEL[elegido.envio.status]}
                    </div>
                  </>
                )}
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
              className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--edr-blue)] px-4 py-3 text-center text-base font-black text-white"
            >
              <Navigation size={20} strokeWidth={2} />
              {elegido.enElComercio ? 'Cómo llegar al comercio' : 'Cómo llegar a destino'}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
