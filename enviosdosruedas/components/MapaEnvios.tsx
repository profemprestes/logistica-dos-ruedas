'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import { CENTRO_MDP } from '@/lib/punto';

/**
 * Varios envíos sobre un mapa.
 *
 * Lo usan el panel (todos los envíos de un período) y la app del repartidor
 * (su hoja de ruta del día). Es el mismo mapa con distintos puntos: si fueran
 * dos componentes, el día que haya que cambiar el color de un estado habría
 * que acordarse de los dos.
 *
 * Leaflet se carga sólo cuando esta pantalla aparece, así el resto de la app
 * no lo arrastra. En el celular del repartidor eso importa: el mapa es una
 * pantalla que se abre de vez en cuando, no algo que tenga que pesar en cada
 * arranque de la hoja de ruta.
 */

export interface PuntoMapa {
  id: number;
  lat: number;
  lng: number;
  /** Lo que va escrito adentro del punto: el número de parada, casi siempre. */
  etiqueta: string;
  /** Color del punto, en hexadecimal (Leaflet dibuja HTML, no clases). */
  color: string;
  titulo: string;
  detalle: string;
}

export default function MapaEnvios({
  puntos,
  miUbicacion,
  alto = 'h-[70vh]',
  onTocar,
}: {
  puntos: PuntoMapa[];
  /** Dónde está el que mira, si dio permiso. */
  miUbicacion?: { lat: number; lng: number } | null;
  alto?: string;
  /** Qué hacer cuando se toca un punto; sin esto sólo se abre el globito. */
  onTocar?: (id: number) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<import('leaflet').Map | null>(null);
  const capa = useRef<import('leaflet').LayerGroup | null>(null);
  const capaYo = useRef<import('leaflet').LayerGroup | null>(null);
  const Lref = useRef<typeof import('leaflet') | null>(null);
  /** Para encuadrar una sola vez y no pelearle el zoom al que está mirando. */
  const encuadrado = useRef(false);

  /**
   * El mapa se arma con un `import()`, o sea que tarda. Sin esta bandera, el
   * efecto que dibuja los puntos corría primero, encontraba el mapa todavía en
   * null y se iba; y como la lista de puntos ya no cambiaba, no volvía a
   * correr nunca. Resultado: el mapa se veía perfecto y vacío.
   */
  const [listo, setListo] = useState(false);

  const alTocar = useRef(onTocar);
  useEffect(() => {
    alTocar.current = onTocar;
  }, [onTocar]);

  useEffect(() => {
    let vivo = true;
    let limpiar = () => {};

    (async () => {
      const L = (await import('leaflet')).default;
      if (!vivo || !caja.current || mapa.current) return;

      const m = L.map(caja.current).setView([CENTRO_MDP.lat, CENTRO_MDP.lng], 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(m);

      Lref.current = L;
      mapa.current = m;
      capa.current = L.layerGroup().addTo(m);
      capaYo.current = L.layerGroup().addTo(m);

      // Nace dentro de una pantalla que todavía se está acomodando: sin esto
      // mide mal el alto y quedan las baldosas grises de un costado.
      setTimeout(() => m.invalidateSize(), 60);

      setListo(true);

      limpiar = () => {
        m.remove();
        mapa.current = null;
        capa.current = null;
        capaYo.current = null;
        encuadrado.current = false;
        setListo(false);
      };
    })();

    return () => {
      vivo = false;
      limpiar();
    };
  }, []);

  /** Los puntos se rehacen cada vez que cambia la lista. */
  useEffect(() => {
    const L = Lref.current;
    const m = mapa.current;
    const g = capa.current;
    if (!L || !m || !g) return;

    g.clearLayers();
    if (puntos.length === 0) return;

    for (const p of puntos) {
      const icono = L.divIcon({
        className: '',
        html:
          `<div style="width:26px;height:26px;border-radius:50%;background:${p.color};` +
          `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);color:#fff;` +
          `font:700 12px/22px system-ui,sans-serif;text-align:center">${p.etiqueta}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });

      const marca = L.marker([p.lat, p.lng], { icon: icono }).addTo(g);

      // El globito arma HTML, así que el texto se escapa: una dirección con
      // comillas o un "<" en el detalle romperían la burbuja.
      marca.bindPopup(
        `<div style="font:600 13px system-ui,sans-serif">${escapar(p.titulo)}</div>` +
          `<div style="font:400 12px system-ui,sans-serif;margin-top:2px">${escapar(p.detalle)}</div>` +
          `<a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" ` +
          `target="_blank" rel="noreferrer" style="font:700 12px system-ui,sans-serif">Cómo llegar ↗</a>`,
      );

      if (alTocar.current) marca.on('click', () => alTocar.current?.(p.id));
    }

    // Encuadra una sola vez. Volver a encuadrar en cada actualización le
    // movería el mapa abajo de la mano al que está mirando una zona.
    if (!encuadrado.current) {
      const limites = L.latLngBounds(puntos.map((p) => [p.lat, p.lng] as [number, number]));
      m.fitBounds(limites, { padding: [40, 40], maxZoom: 16 });
      encuadrado.current = true;
    }
  }, [puntos, listo]);

  /** Dónde está el que mira: aparte, para que no se rehaga con cada punto. */
  useEffect(() => {
    const L = Lref.current;
    const g = capaYo.current;
    if (!L || !g) return;

    g.clearLayers();
    if (!miUbicacion) return;

    L.marker([miUbicacion.lat, miUbicacion.lng], {
      icon: L.divIcon({
        className: '',
        html:
          '<div style="width:16px;height:16px;border-radius:50%;background:#38bdf8;' +
          'border:3px solid #fff;box-shadow:0 0 0 2px rgba(56,189,248,.5)"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      }),
    })
      .addTo(g)
      .bindPopup('Estás acá');
  }, [miUbicacion, listo]);

  return (
    <div
      ref={caja}
      className={`w-full overflow-hidden rounded-lg border border-[var(--edr-border)] ${alto}`}
      // Las baldosas son claras: sin fondo blanco, mientras cargan se ve el
      // azul del panel y parece que está roto.
      style={{ background: '#fff' }}
    />
  );
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
