'use client';

import { useState } from 'react';

/**
 * Copia el link de seguimiento del envío, listo para pegar en WhatsApp.
 *
 * El dominio sale de la ventana y no de una constante: así en la computadora
 * de prueba copia localhost y en producción el dominio real, sin que haya que
 * acordarse de cambiar nada.
 */
export function trackUrl(trackingCode: string): string {
  const base = typeof window === 'undefined' ? 'https://www.logisticadosruedas.com' : window.location.origin;
  return `${base}/seguimiento/${trackingCode}`;
}

export default function CopyTrackLink({
  trackingCode,
  className = '',
}: {
  trackingCode: string;
  className?: string;
}) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(trackUrl(trackingCode));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles (pasa en http que no sea localhost):
      // mostrarlo alcanza para que lo copie a mano.
      prompt('Copiá el link:', trackUrl(trackingCode));
    }
  }

  return (
    <button
      onClick={copiar}
      title="Copiar link de seguimiento para mandarle al cliente"
      aria-label="Copiar link de seguimiento"
      className={`rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)] ${className}`}
    >
      {copiado ? '✓ Copiado' : '🔗 Link'}
    </button>
  );
}
