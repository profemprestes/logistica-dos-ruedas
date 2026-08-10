'use client';

import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/**
 * ¿Hay señal? En el servidor asumimos que sí, así el HTML inicial no parpadea.
 *
 * Ojo: `navigator.onLine` sólo mira si el celular está enganchado a una red;
 * con una antena saturada dice "true" y las subidas igual fallan. Por eso la
 * cola offline nunca confía en este valor para dar por enviada una entrega.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
