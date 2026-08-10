'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type Tone = 'info' | 'ok' | 'warn' | 'error';

interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

const TONE_CLASS: Record<Tone, string> = {
  info: 'bg-[var(--edr-blue)] text-white',
  ok: 'bg-emerald-600 text-white',
  warn: 'bg-amber-400 text-black',
  error: 'bg-red-600 text-white',
};

const ToastContext = createContext<(text: string, tone?: Tone) => void>(() => {});

/** `const toast = useToast(); toast('Guardado', 'ok');` */
export function useToast() {
  return useContext(ToastContext);
}

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const show = useCallback((text: string, tone: Tone = 'info') => {
    const id = ++seq;
    setItems((prev) => [...prev, { id, text, tone }]);
    // Los avisos de "sin conexión" tienen que dar tiempo a leerse manejando.
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  return (
    <ToastContext value={show}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-center text-base font-bold shadow-lg ${TONE_CLASS[t.tone]}`}
            onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
