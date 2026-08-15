'use client';

import { useEffect, useRef } from 'react';

/**
 * Que el "atrás" del celular cierre el cuadro en vez de salir de la app.
 *
 * EL PROBLEMA. El escáner, el detalle del envío y el cierre de entrega ocupan
 * toda la pantalla, pero para el navegador no son páginas: son la misma página
 * con algo dibujado encima. Así que el atrás de Android no los cierra, se lleva
 * puesta la página entera — y si la app se abrió directo en la hoja de ruta, no
 * hay nada atrás y se sale de la app. Reportado desde la calle: abrir el
 * escáner, tocar atrás, y quedarse afuera.
 *
 * CÓMO SE ARREGLA. Al abrirse, el cuadro agrega un paso al historial. Entonces
 * el atrás tiene algo que sacar: saca ese paso, no la página. Escuchamos ese
 * momento y cerramos el cuadro.
 *
 * Y AL CERRAR CON EL BOTÓN hay que sacar ese paso nosotros, o quedaría uno de
 * más y el siguiente atrás no haría nada visible.
 *
 * Se usa desde un componente que sólo existe mientras el cuadro está abierto,
 * que es como están hechos los cuatro.
 */

/**
 * Cuántos cuadros hay abiertos.
 *
 * Hace falta por un caso que parece raro y es de todos los días: desde el
 * detalle se toca "entregado", el detalle se cierra y el cierre de entrega se
 * abre en el mismo movimiento. Sin esta cuenta, el detalle sacaría su paso del
 * historial justo después de que el cierre agregó el suyo, y el cuadro nuevo se
 * cerraría solo.
 */
let abiertos = 0;

export function useCerrarConAtras(cerrar: () => void): void {
  // Por referencia: así el cuadro no se reinicia cada vez que el padre dibuja
  // de nuevo y le pasa otra función.
  const cerrarRef = useRef(cerrar);
  useEffect(() => {
    cerrarRef.current = cerrar;
  }, [cerrar]);

  useEffect(() => {
    abiertos += 1;

    /*
     * Un solo paso para todos los cuadros encadenados.
     *
     * Si el paso de arriba ya es nuestro —pasa al ir del detalle al cierre de
     * entrega, donde uno se va y el otro entra— no se agrega otro. Con dos,
     * cerrar dejaba uno colgado, y el siguiente "atrás" no hacía nada visible:
     * el repartidor toca, no pasa nada, vuelve a tocar y se sale de la app.
     */
    if (window.history.state?.edrCuadro !== true) {
      window.history.pushState({ edrCuadro: true }, '');
    }

    const alVolver = () => cerrarRef.current();
    window.addEventListener('popstate', alVolver);

    return () => {
      abiertos -= 1;
      window.removeEventListener('popstate', alVolver);

      /*
       * Se saca el paso recién en el siguiente turno, y sólo si no quedó otro
       * cuadro abierto. Para entonces ya corrió el que se estaba abriendo, si
       * es que había uno.
       *
       * Si el cierre vino del atrás del celular, el paso ya lo sacó el
       * navegador: se nota porque el estado actual del historial ya no es
       * nuestro, y entonces no se toca nada.
       */
      setTimeout(() => {
        if (abiertos === 0 && window.history.state?.edrCuadro) window.history.back();
      }, 0);
    };
  }, []);
}
