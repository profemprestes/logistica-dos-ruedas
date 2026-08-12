'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { CENTRO_MDP, type Punto } from '@/lib/punto';

/**
 * Mapa para poner el punto a dedo.
 *
 * Hay direcciones que no resuelve ningún buscador: esquinas sin altura ("calle
 * 20 y calle 491"), barrios nuevos que todavía no están en OpenStreetMap,
 * referencias del tipo "el galpón atrás de la estación". Para esas, la única
 * fuente confiable es alguien que sabe dónde queda: se hace clic y listo.
 *
 * Es el único lugar del sistema con un mapa de verdad en vez del recuadro de
 * OpenStreetMap. El recuadro es una imagen dentro de un iframe y no puede
 * avisar dónde se tocó; acá justamente lo que hace falta es eso.
 *
 * Leaflet se carga recién cuando el componente aparece en pantalla, y el panel
 * no lo arrastra en su bundle.
 */
export default function MapaElegible({
  punto,
  onElegir,
}: {
  /** Dónde arranca. Si no hay nada todavía, abre en el centro de Mar del Plata. */
  punto: Punto | null;
  onElegir: (p: Punto) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);

  /**
   * El callback y el punto viven en refs para que el mapa se arme UNA vez.
   * Si fueran dependencias del efecto, cada tecla del formulario de arriba lo
   * destruiría y lo volvería a crear, perdiendo el zoom y el encuadre que la
   * persona acomodó para encontrar la esquina.
   */
  const alElegir = useRef(onElegir);
  useEffect(() => {
    alElegir.current = onElegir;
  }, [onElegir]);

  const marcador = useRef<import('leaflet').Marker | null>(null);
  const mapa = useRef<import('leaflet').Map | null>(null);

  useEffect(() => {
    let vivo = true;
    let limpiar = () => {};

    (async () => {
      const L = (await import('leaflet')).default;
      if (!vivo || !caja.current || mapa.current) return;

      const inicio = punto ?? CENTRO_MDP;
      const m = L.map(caja.current, { attributionControl: true }).setView(
        [inicio.lat, inicio.lng],
        punto ? 17 : 13,
      );

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(m);

      // Un icono hecho con HTML y no con una imagen: los PNG que Leaflet trae
      // por defecto se buscan por una ruta relativa que el empaquetador cambia,
      // y el marcador terminaría siendo un cuadrado roto.
      const icono = L.divIcon({
        className: '',
        html: '<div style="width:18px;height:18px;border-radius:50%;background:#ffec01;border:3px solid #111;box-shadow:0 0 0 2px #fff"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const marca = L.marker([inicio.lat, inicio.lng], { icon: icono, draggable: true }).addTo(m);

      const mover = (lat: number, lng: number) => {
        marca.setLatLng([lat, lng]);
        alElegir.current({ lat, lng });
      };

      m.on('click', (e) => mover(e.latlng.lat, e.latlng.lng));
      marca.on('dragend', () => {
        const p = marca.getLatLng();
        alElegir.current({ lat: p.lat, lng: p.lng });
      });

      mapa.current = m;
      marcador.current = marca;

      // El mapa nace dentro de un modal que todavía se está acomodando: sin
      // esto mide mal el alto y quedan las baldosas grises a la derecha.
      setTimeout(() => m.invalidateSize(), 60);

      limpiar = () => {
        m.remove();
        mapa.current = null;
        marcador.current = null;
      };
    })();

    return () => {
      vivo = false;
      limpiar();
    };
    // Se arma una sola vez: el punto inicial se lee al momento de crearlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Un punto que llega de afuera (una búsqueda que dio bien) mueve la marca. */
  useEffect(() => {
    if (!punto || !mapa.current || !marcador.current) return;
    const actual = marcador.current.getLatLng();
    if (Math.abs(actual.lat - punto.lat) < 1e-7 && Math.abs(actual.lng - punto.lng) < 1e-7) return;
    marcador.current.setLatLng([punto.lat, punto.lng]);
    mapa.current.setView([punto.lat, punto.lng], Math.max(mapa.current.getZoom(), 16));
  }, [punto]);

  return (
    <div
      ref={caja}
      className="h-72 w-full overflow-hidden rounded border border-[var(--edr-border)]"
      // Leaflet dibuja las baldosas en claro: sin fondo blanco, mientras cargan
      // se ve el gris del panel y parece que está roto.
      style={{ background: '#fff' }}
    />
  );
}
