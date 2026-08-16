'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'info' | 'ok' | 'warn' | 'error';

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

/**
 * Todos sobre el azul profundo, y el color sólo en el ícono.
 *
 * Antes cada tono pintaba la píldora entera —verde, ámbar, rojo—, y sobre el
 * azul de la app tres colores distintos apareciendo abajo era ruido. Ahora la
 * píldora es siempre la misma y lo que cambia es la marca de la izquierda, que
 * es lo que se mira.
 */
const TONE_CLASS: Record<Tone, string> = {
  info: 'bg-[var(--edr-dark)] text-white',
  ok: 'bg-[var(--edr-dark)] text-white',
  warn: 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]',
  error: 'bg-[var(--edr-rojo)] text-white',
};

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

/** `const toast = useToast(); toast('Guardado', 'ok');` */
export function useToast() {
  return useContext(ToastContext);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  /**
   * Cuánto queda en pantalla, según lo que diga.
   *
   * Seis segundos para todo era demasiado para un "marcado en camino": el
   * repartidor ya sabe lo que hizo, lo tocó él. Los seis se justifican para lo
   * que hay que leer y entender —un rechazo del servidor, un aviso de que algo
   * quedó sin enviar—, y para eso siguen estando.
   */
  const show = useCallback((text: string, tone: Tone = 'info') => {
    const id = ++seq;
    setItems((prev) => [...prev, { id, text, tone }]);
    const duracion = tone === 'error' || tone === 'warn' ? 6000 : 2600;
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), duracion);
  }, []);

  return (
    <ToastContext value={show}>
      {children}

      {/*
        VA ARRIBA, Y ESO ES EL ARREGLO.

        Estaba fijo a 7rem del piso, ancho completo: caía justo encima de los
        botones de entregar. El repartidor tocaba "salgo en camino", aparecía el
        aviso tapando lo que iba a tocar después, y había que esperar a que se
        fuera o correrlo de encima. Reportado desde la calle.

        Arriba no molesta a nadie: la mano trabaja abajo, y de paso queda cerca
        de la cabecera, que es donde el repartidor ya mira el estado de la señal.

        Y se achicó. Un "marcado en camino" no necesita ocupar media pantalla:
        el repartidor ya sabe lo que hizo porque lo tocó él, sólo quiere ver que
        el sistema se enteró.
      */}
      <div
        // La altura va por estilo y no por clase: una clase nueva de Tailwind
        // puede no llegar a generarse en desarrollo, y ahí el aviso se cae al
        // fondo de la página sin que nada avise. Ya pasó con un color hoy.
        style={{ top: '4.5rem' }}
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-1.5 px-3"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto max-w-md rounded-full px-3.5 py-2 text-center text-sm font-bold shadow-lg ${TONE_CLASS[t.tone]}`}
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
