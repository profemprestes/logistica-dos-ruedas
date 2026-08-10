'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Monta su contenido dentro de <div id="print-root"> colgando directo de <body>.
 * Eso permite que globals.css oculte TODA la app al imprimir con una sola regla
 * (body > *:not(#print-root)) y no queden hojas en blanco de más.
 *
 * El div se crea suelto en el primer render y recién el efecto lo cuelga del body:
 * así no hace falta guardar el nodo en un estado ni forzar un segundo render.
 */
export default function PrintPortal({ children }: { children: ReactNode }) {
  // El div se arma una sola vez, suelto. En el servidor no hay document: queda en null.
  const [node] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.id = 'print-root';
    return el;
  });

  useEffect(() => {
    if (!node) return;
    document.body.appendChild(node);
    // Al desmontar se lleva su div: no queda un #print-root huérfano dando vueltas.
    return () => node.remove();
  }, [node]);

  if (!node) return null;
  return createPortal(children, node);
}
