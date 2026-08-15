'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';

/**
 * Buscador de envíos, en la portada misma.
 *
 * Antes había que entrar a /seguimiento y recién ahí escribir el código: dos
 * pasos para lo que más hace la gente que cae acá. Buscar es ir a
 * `/seguimiento/CODIGO`, así el resultado queda en la dirección y se puede
 * compartir; los códigos que no existen los explica esa pantalla.
 */
export default function TrackBox() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [yendo, setYendo] = useState(false);

  function buscar() {
    const limpio = code.trim().toUpperCase();
    if (!limpio) return;
    setYendo(true);
    router.push(`/seguimiento/${encodeURIComponent(limpio)}`);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && buscar()}
        placeholder="EDR00001015MDQ"
        aria-label="Código de seguimiento"
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        className="edr-mono min-w-0 flex-1 rounded-full border-2 border-[var(--edr-border)] bg-white px-6 py-4 text-center text-lg font-bold uppercase text-[var(--edr-blue-dark)] outline-none placeholder:font-normal placeholder:text-[var(--edr-blue-dark)]/35 focus:border-[var(--edr-blue)] sm:text-left"
      />
      <button
        onClick={buscar}
        disabled={yendo || !code.trim()}
        className="flex items-center justify-center gap-2 rounded-full bg-[var(--edr-blue)] px-8 py-4 font-bebas text-xl tracking-[.07em] text-white transition hover:brightness-110 disabled:opacity-40"
      >
        <Search size={18} strokeWidth={2.5} />
        {yendo ? 'BUSCANDO…' : 'SEGUIR ENVÍO'}
      </button>
    </div>
  );
}
