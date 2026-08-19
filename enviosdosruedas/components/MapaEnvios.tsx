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
  /** Color de lo que va escrito adentro. Sobre amarillo, el blanco no se lee. */
  colorTexto?: string;
  titulo: string;
  detalle: string;
  /**
   * Metros de incertidumbre. Con esto se dibuja un círculo alrededor del punto
   * en vez de un pin a secas: es la diferencia entre decir "está acá" y decir
   * "anda por acá adentro". Se usa para la moto, cuya posición se publica
   * aproximada a propósito.
   */
  radio?: number;
  /**
   * Imagen para el punto, en lugar de la etiqueta. Se usa para el logo en el
   * seguimiento: el que espera reconoce de quién es la moto que se le acerca.
   */
  imagen?: string;
}

export default function MapaEnvios({
  puntos,
  miUbicacion,
  alto = 'edr-mapa',
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

  /**
   * Si el mapa está esperando el primer toque para dejarse arrastrar.
   *
   * Sólo pasa en el teléfono, y hay que DECIRLO: un mapa que no responde al
   * dedo, sin explicación, se lee como un mapa roto.
   */
  const [dormido, setDormido] = useState(false);

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

      /*
       * EN EL TELÉFONO EL MAPA ARRANCA QUIETO, y se despierta al tocarlo.
       *
       * Leaflet le pone `touch-action: none` al mapa, así que cualquier dedo
       * que empiece ahí lo captura él entero. Con el mapa ocupando el 65% de
       * la pantalla en el medio de una página larga, no queda por dónde
       * scrollear: el panel se volvía imposible de navegar desde el celular.
       * Medido el 19/08/2026: 528 px de mapa sobre 812 de pantalla.
       *
       * Así que en pantallas chicas nace sin arrastre —el dedo pasa de largo y
       * la página scrollea— y se activa con un toque, que es lo mismo que hace
       * cualquier mapa metido adentro de una página. En la computadora no
       * cambia nada: ahí se scrollea con la rueda y no hay conflicto.
       */
      const enElTelefono =
        typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

      const m = L.map(caja.current, { dragging: !enElTelefono }).setView(
        [CENTRO_MDP.lat, CENTRO_MDP.lng],
        12,
      );

      if (enElTelefono) {
        // Un toque lo despierta. `once` alcanza: una vez despierto, se queda.
        caja.current.addEventListener(
          'click',
          () => {
            m.dragging.enable();
            setDormido(false);
          },
          { once: true },
        );
        setDormido(true);
      }
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(m);

      Lref.current = L;
      mapa.current = m;
      capa.current = L.layerGroup().addTo(m);
      capaYo.current = L.layerGroup().addTo(m);

      // Nace dentro de una pantalla que todavía se está acomodando: sin esto
      // mide mal el alto y quedan las baldosas grises de un costado. El id se
      // guarda para poder cancelarlo: si la pantalla se cierra en esos 60 ms,
      // el temporizador encuentra un mapa ya desarmado y tira error.
      const ajuste = window.setTimeout(() => m.invalidateSize(), 60);

      setListo(true);

      limpiar = () => {
        window.clearTimeout(ajuste);
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
      // El círculo va primero para que quede DEBAJO del icono: dibujado
      // después, se come los clics del marcador que tiene adentro.
      if (p.radio) {
        L.circle([p.lat, p.lng], {
          radius: p.radio,
          color: p.color,
          weight: 2,
          opacity: 0.7,
          fillColor: p.color,
          fillOpacity: 0.12,
        }).addTo(g);
      }

      // El logo va más grande que un punto numerado: a 26 píxeles es una
      // mancha. A 44 tampoco se le lee el texto, pero se reconoce la forma y
      // el color, que es lo que hace falta para saber de quién es la moto.
      const lado = p.imagen ? 44 : 26;

      const icono = L.divIcon({
        className: '',
        html: p.imagen
          ? `<img src="${p.imagen}" alt="" style="width:${lado}px;height:${lado}px;` +
            `border-radius:50%;border:2px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.55);` +
            `background:#fff;object-fit:cover;display:block">`
          : `<div style="width:${lado}px;height:${lado}px;border-radius:50%;background:${p.color};` +
            `border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);` +
            `color:${p.colorTexto ?? '#fff'};` +
            `font:700 14px/22px system-ui,sans-serif;text-align:center">${p.etiqueta}</div>`,
        iconSize: [lado, lado],
        iconAnchor: [lado / 2, lado / 2],
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

      // Un círculo de 500 metros no entra en el encuadre de su propio centro:
      // sin esto queda cortado por los bordes del mapa.
      //
      // Se calcula con `toBounds`, que es pura geometría. Pedirle los límites a
      // un `L.circle` recién creado NO funciona: un círculo que todavía no
      // está agregado a ningún mapa no tiene con qué convertir metros a
      // píxeles y revienta con "layerPointToLatLng of undefined". Eso rompía
      // la pantalla entera, no sólo el encuadre.
      for (const p of puntos) {
        if (p.radio) limites.extend(L.latLng(p.lat, p.lng).toBounds(p.radio * 2));
      }

      /*
       * Encuadrar recién cuando el mapa sepa cuánto mide.
       *
       * Nace adentro de una pantalla que todavía se está armando, y en ese
       * momento su caja puede medir cero. Un `fitBounds` con esa medida da un
       * centro y un zoom cualquiera, y como después no se vuelve a encuadrar,
       * los puntos quedaban FUERA de la vista: el mapa se veía bien pero
       * mostraba otro pedazo de la ciudad. Pasaba en el seguimiento, donde el
       * mapa vive dentro de una grilla que se acomoda después.
       *
       * Se reintenta unas pocas veces y se abandona: mejor un encuadre feo que
       * un temporizador dando vueltas para siempre en el celular de alguien.
       */
      let intentos = 0;
      const encuadrar = () => {
        if (mapa.current !== m) return; // la pantalla se cerró mientras tanto
        m.invalidateSize();

        if (m.getSize().x < 50 && intentos < 10) {
          intentos++;
          window.setTimeout(encuadrar, 80);
          return;
        }

        // Sin animación a propósito. Con la animación puesta, el zoom arrancaba
        // a moverse y quedaba a mitad de camino: el mapa terminaba en el zoom
        // inicial mostrando media ciudad, con los puntos afuera de la vista.
        m.fitBounds(limites, { padding: [30, 30], maxZoom: 16, animate: false });
      };

      encuadrar();
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
    /*
      `isolate` NO ES DECORACIÓN: es lo que mantiene el mapa adentro del mapa.

      Leaflet apila lo suyo con números altos —las capas en 200 a 700, los
      botones de zoom y el cartel de OpenStreetMap en 1000— y esos números sólo
      quedan encerrados si algo arriba forma su propia pila. Sin eso compiten
      con la página entera, y el menú del celular (que va en 50) quedaba abajo:
      se abría el cajón y los botones del mapa seguían flotando encima.

      `isolation: isolate` hace justamente eso y nada más: los 1000 pasan a ser
      1000 adentro de esta caja, y la caja se ordena con el resto como lo que
      es, un pedazo del contenido.

      Vale para cualquier cosa que se abra sobre un mapa —el cajón, el
      comprobante, el formulario de carga—, no sólo para el caso que lo
      destapó.
    */
    <div className="relative isolate">
      <div
        ref={caja}
        className={`w-full overflow-hidden rounded-lg border border-[var(--edr-border)] ${alto}`}
        // Las baldosas son claras: sin fondo blanco, mientras cargan se ve el
        // azul del panel y parece que está roto.
        style={{ background: '#fff' }}
      />

      {/* El cartelito del mapa dormido. Va sobre el mapa pero sin taparlo y sin
          recibir el toque —`pointer-events: none`— porque el toque tiene que
          llegar al mapa: es el que lo despierta. */}
      {dormido && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs font-bold text-white">
            Tocá el mapa para moverlo
          </span>
        </div>
      )}
    </div>
  );
}

function escapar(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
