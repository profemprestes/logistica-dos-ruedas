'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Navigation } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { readCachedRoute } from '@/lib/driver/db';
import { getFix, type Fix } from '@/lib/driver/geo';
import { misColectas, paquetesDeLaColecta, type Colecta, type Paquete } from '@/lib/driver/colectas';
import { useOnline } from '@/lib/driver/useOnline';
import { partirRuta } from '@/lib/scheduled';
import { marcaDeEstado, nombreDelDestinatario, STATUS_LABEL, type Shipment } from '@/lib/format';
import type { PuntoMapa } from '@/components/MapaEnvios';

const MapaEnvios = dynamic(() => import('@/components/MapaEnvios'), {
  ssr: false,
  loading: () => (
    <div className="edr-mapa flex items-center justify-center rounded-lg border border-dashed border-[var(--edr-border)] text-sm font-bold text-[var(--edr-muted)]">
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
/** Un envío ubicado: dónde se dibuja y por qué ahí. */
interface Ubicado {
  envio: Shipment;
  lat: number | null;
  lng: number | null;
  enElComercio: boolean;
  comercio: string | null;
}

/**
 * Lo que se abre al tocar un punto.
 *
 * SON TRES COSAS DISTINTAS y antes se trataban como una. Un punto de retiro
 * con cuatro paquetes abría la ficha de UNO —el primero de la pila— y los
 * otros tres no aparecían por ningún lado: el repartidor tocaba el punto que
 * decía "4", leía una sola dirección, y se iba pensando que era uno solo. Y
 * una colecta directamente no abría nada: el toque no hacía absolutamente
 * nada, que es peor que abrir algo incompleto porque parece que la app se
 * colgó.
 */
type Elegido =
  | { tipo: 'entrega'; lat: number; lng: number; envio: Shipment }
  | {
      tipo: 'retiro';
      lat: number;
      lng: number;
      direccion: string;
      comercio: string | null;
      envios: Shipment[];
    }
  | { tipo: 'colecta'; lat: number; lng: number; colecta: Colecta };

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
  const [elegido, setElegido] = useState<Elegido | null>(null);
  /**
   * Las colectas pendientes, que son lugares a los que ir SIN envío de por
   * medio. Van al mismo mapa a propósito: el repartidor mira un solo mapa para
   * decidir por dónde arrancar, y una colecta que vive en otra pantalla es una
   * parada que no entra en esa cuenta.
   */
  const [colectas, setColectas] = useState<Colecta[]>([]);
  /**
   * Qué paquetes lo esperan en cada colecta, por dirección.
   *
   * Se piden JUNTO CON las colectas y no al tocar el punto, igual que en la
   * tarjeta de "Pasá a retirar": el repartidor mira esto arriba de la moto, y
   * un toque que se queda cargando es un toque que no va a esperar.
   */
  const [paquetes, setPaquetes] = useState<Map<string, Paquete[]>>(new Map());

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

    void misColectas().then(async (cs) => {
      if (!vivo) return;
      setColectas(cs);

      const mapa = new Map<string, Paquete[]>();
      await Promise.all(
        cs.map(async (c) => {
          mapa.set(c.direccion, await paquetesDeLaColecta(c.direccion));
        }),
      );
      if (vivo) setPaquetes(mapa);
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
      deHoy.map((s): Ubicado => {
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

  const puntosYGrupos = useMemo(() => {
    /*
     * UN SOLO PUNTO POR COMERCIO, con la R.
     *
     * Cuatro paquetes del mismo lugar son cuatro marcas encimadas en la misma
     * coordenada: se ve una sola, tapa a las otras tres, y al tocarla se abre
     * la de arriba como si fuera la única. Un punto que dice "acá hay 4" es lo
     * que el repartidor necesita para decidir por dónde arrancar.
     */
    const porComercio = new Map<string, Ubicado[]>();
    const entregas: PuntoMapa[] = [];

    for (const u of conPunto) {
      if (!u.enElComercio) {
        const marca = marcaDeEstado(u.envio.status);
        entregas.push({
          id: u.envio.id,
          lat: u.lat as number,
          lng: u.lng as number,
          etiqueta: marca.simbolo,
          color: marca.color,
          colorTexto: marca.colorTexto,
          titulo: u.envio.address_street,
          detalle: `${nombreDelDestinatario(u.envio)} · ${STATUS_LABEL[u.envio.status]}`,
        });
        continue;
      }

      const clave = `${u.lat},${u.lng}`;
      porComercio.set(clave, [...(porComercio.get(clave) ?? []), u]);
    }

    // El grupo entero queda guardado, no sólo el primero: al tocar el punto hay
    // que poder listar los cuatro paquetes y no uno.
    const grupos = new Map<number, Ubicado[]>();

    const retiros: PuntoMapa[] = [...porComercio.values()].map((delLugar) => {
      const u = delLugar[0];
      grupos.set(u.envio.id, delLugar);
      return {
        id: u.envio.id,
        lat: u.lat as number,
        lng: u.lng as number,
        etiqueta: 'R',
        color: AZUL_RETIRO,
        colorTexto: '#fff',
        titulo: `Retirar en ${u.envio.pickup_address ?? u.comercio ?? ''}`,
        detalle: `${u.comercio ?? 'Comercio'} · ${delLugar.length} paquete${delLugar.length > 1 ? 's' : ''}`,
      };
    });

    return { puntos: [...entregas, ...retiros], grupos };
  }, [conPunto]);

  const puntos = puntosYGrupos.puntos;
  const gruposDeRetiro = puntosYGrupos.grupos;

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
          etiqueta: 'R',
          color: AZUL_RETIRO,
          colorTexto: '#fff',
          titulo: `Colecta · ${c.direccion}`,
          detalle: [c.comercio, c.nota].filter(Boolean).join(' · '),
        })),
    [colectas],
  );

  /**
   * Qué se tocó, mirando el id.
   *
   * Negativo es una colecta, un id que está en los grupos es un punto de
   * retiro con todos sus paquetes, y el resto es una entrega suelta.
   */
  function queSeToco(id: number): Elegido | null {
    if (id < 0) {
      const c = colectas.find((x) => x.id === -id);
      if (!c || c.lat == null || c.lng == null) return null;
      return { tipo: 'colecta', lat: Number(c.lat), lng: Number(c.lng), colecta: c };
    }

    const grupo = gruposDeRetiro.get(id);
    if (grupo?.length) {
      const primero = grupo[0];
      return {
        tipo: 'retiro',
        lat: primero.lat as number,
        lng: primero.lng as number,
        direccion: primero.envio.pickup_address ?? primero.comercio ?? '',
        comercio: primero.comercio,
        envios: grupo.map((u) => u.envio),
      };
    }

    const u = ubicados.find((x) => x.envio.id === id);
    if (!u || u.lat == null || u.lng == null) return null;
    return { tipo: 'entrega', lat: u.lat, lng: u.lng, envio: u.envio };
  }

  return (
    <div className="pb-6">
      <header className="px-3.5 pt-4">
        <h1 className="font-anton text-[26px] uppercase leading-none tracking-[-.02em] text-white">
          Mapa del día
        </h1>
        <p className="mt-1 font-bebas text-base tracking-[.06em] text-[var(--edr-muted)]">
          {cargando
            ? 'CARGANDO…'
            : deHoy.length === 0 && puntosColecta.length > 0
              ? // Sin envíos pero con colecta: contar "0 DE 0" sería mentirle,
                // porque en el mapa SÍ hay algo y es justamente a donde tiene
                // que ir.
                `${puntosColecta.length} LUGAR(ES) PARA RETIRAR`
              : `${conPunto.length} DE ${deHoy.length} EN EL MAPA`}
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

        {/*
          El mapa se dibuja si hay ALGO que dibujar, y una colecta es algo.

          Antes miraba sólo los envíos, así que el repartidor que todavía no
          escaneó nada —que es el que más lo necesita, porque no sabe para
          dónde arrancar— se encontraba con el cartel de "no tenés envíos" y el
          comercio al que tenía que ir no aparecía en ningún lado.
        */}
        {!cargando && conPunto.length === 0 && puntosColecta.length === 0 ? (
          <div className="flex h-56 items-center justify-center rounded-lg border-2 border-dashed border-[var(--edr-border)] px-6 text-center text-sm font-bold text-[var(--edr-muted)]">
            {deHoy.length === 0
              ? 'No tenés envíos para hoy.'
              : 'Ninguno de los envíos de hoy tiene punto cargado.'}
          </div>
        ) : (
          <MapaEnvios
            puntos={[...puntos, ...puntosColecta]}
            miUbicacion={yo}
            alto="edr-mapa"
            onTocar={(id) => setElegido(queSeToco(id))}
          />
        )}

        {elegido && (
          <div className="rounded-xl border-4 border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {/* Lo primero que se lee tiene que ser a dónde ir AHORA. Para un
                    paquete sin retirar eso es el comercio, no la casa del
                    cliente — que es adonde hay que ir después. */}
                {elegido.tipo === 'entrega' ? (
                  <>
                    <div className="text-xl font-black leading-tight">
                      {elegido.envio.address_street}
                    </div>
                    {elegido.envio.address_extra && (
                      <div className="text-base font-bold">{elegido.envio.address_extra}</div>
                    )}
                    <div className="text-sm text-[var(--edr-muted)]">
                      {nombreDelDestinatario(elegido.envio)} · {STATUS_LABEL[elegido.envio.status]}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-bebas text-base tracking-[.08em] text-[var(--edr-acento)]">
                      RETIRAR EN
                    </div>
                    <div className="text-xl font-black leading-tight">
                      {elegido.tipo === 'retiro' ? elegido.direccion : elegido.colecta.direccion}
                    </div>
                    <div className="text-sm text-[var(--edr-muted)]">
                      {elegido.tipo === 'retiro'
                        ? elegido.comercio
                        : [elegido.colecta.comercio, elegido.colecta.nota]
                            .filter(Boolean)
                            .join(' · ')}
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

            {/*
              TODO lo que hay que retirar ahí, no el primero de la pila.

              Un punto que dice "4 paquetes" y al tocarlo muestra una sola
              dirección es peor que no mostrar nada: el repartidor se va del
              comercio con uno creyendo que era uno. Cuando ya son suyos se
              listan con destinatario; cuando todavía no los escaneó, sólo la
              dirección de entrega, que es lo único que le corresponde ver
              hasta que los tenga en la moto.
            */}
            {elegido.tipo === 'retiro' && (
              <ul className="mt-2.5 flex flex-col gap-0.5 rounded-xl bg-black/20 px-3 py-2.5">
                <li className="font-bebas text-sm tracking-[.06em] text-[var(--edr-acento)]">
                  {elegido.envios.length} PAQUETE{elegido.envios.length > 1 ? 'S' : ''} PARA LLEVAR
                </li>
                {elegido.envios.map((e) => (
                  <li key={e.id} className="text-[15px] font-semibold">
                    {e.address_street}
                    <span className="text-[var(--edr-muted)]">
                      {' · '}
                      {nombreDelDestinatario(e)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {elegido.tipo === 'colecta' &&
              (paquetes.get(elegido.colecta.direccion)?.length ?? 0) > 0 && (
                <ul className="mt-2.5 flex flex-col gap-0.5 rounded-xl bg-black/20 px-3 py-2.5">
                  <li className="font-bebas text-sm tracking-[.06em] text-[var(--edr-acento)]">
                    LO QUE TENÉS QUE RETIRAR
                  </li>
                  {paquetes.get(elegido.colecta.direccion)!.map((p, i) => (
                    <li key={`${p.destino}-${i}`} className="text-[15px] font-semibold">
                      {p.destino}
                    </li>
                  ))}
                </ul>
              )}

            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${elegido.lat},${elegido.lng}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[var(--edr-blue)] px-4 py-3 text-center text-base font-black text-white"
            >
              <Navigation size={20} strokeWidth={2} />
              {elegido.tipo === 'entrega' ? 'Cómo llegar a destino' : 'Cómo llegar al comercio'}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
