'use client';

import { useEffect, useRef, useState } from 'react';
import { useCerrarConAtras } from '@/lib/driver/useAtras';
import type { Html5Qrcode } from 'html5-qrcode';

const CONTAINER_ID = 'edr-qr-reader';

/**
 * Lector de QR a pantalla completa.
 *
 * Lo delicado acá es apagar la cámara. `start()` es asíncrono: si el repartidor
 * cierra el modal antes de que termine de arrancar, el `stop()` del cleanup no
 * encuentra nada que apagar y la cámara queda prendida comiendo batería.
 * Por eso el cleanup se encadena a la promesa de arranque en vez de correr suelto.
 */
export default function QrScannerModal({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');

  // El atrás del celular cierra el lector, no la app.
  useCerrarConAtras(onClose);

  // El handler se guarda en un ref para que cambiarlo no reinicie la cámara.
  const onDetectedRef = useRef(onDetected);
  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    let scanner: Html5Qrcode | null = null;
    let closed = false;
    let handled = false;

    const startup = (async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (closed) return;

      scanner = new Html5Qrcode(CONTAINER_ID, { verbose: false });

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          // Recuadro grande: el QR de la etiqueta 10x15 se lee de lejos y con guantes.
          qrbox: (viewWidth, viewHeight) => {
            const side = Math.floor(Math.min(viewWidth, viewHeight) * 0.75);
            return { width: side, height: side };
          },
        },
        (text) => {
          if (handled) return; // Un QR dispara varias lecturas por segundo.
          handled = true;
          navigator.vibrate?.(120);
          onDetectedRef.current(text.trim());
        },
        undefined, // los "no encontré nada en este cuadro" no nos interesan
      );
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'No se pudo abrir la cámara.');
    });

    return () => {
      closed = true;
      startup.finally(async () => {
        if (!scanner) return;
        try {
          await scanner.stop(); // corta el stream: se apaga la luz de la cámara
        } catch {
          // Ya estaba apagada (nunca llegó a arrancar): nada que hacer.
        }
        try {
          scanner.clear();
        } catch {
          // El contenedor ya se fue del DOM.
        }
      });
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-lg font-bold">Escanear paquete</h2>
        <button
          onClick={onClose}
          className="rounded-lg bg-[var(--edr-surface)]/15 px-4 py-2 text-base font-bold active:bg-[var(--edr-surface)]/25"
        >
          Cerrar
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div id={CONTAINER_ID} className="h-full w-full [&_video]:h-full [&_video]:object-cover" />
        {!error && (
          <p className="absolute inset-x-0 bottom-4 text-center text-base font-semibold drop-shadow">
            Apuntá al QR de la etiqueta
          </p>
        )}
      </div>

      <div className="space-y-3 bg-[var(--edr-blue)] px-4 py-4">
        {error && (
          <p className="rounded-lg bg-red-600 px-3 py-2 text-center text-sm font-bold">{error}</p>
        )}

        {/* Etiqueta rota, mojada o QR que no engancha: se carga el código a mano. */}
        <div className="flex gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            inputMode="text"
            placeholder="Código a mano"
            className="edr-mono min-w-0 flex-1 rounded-lg bg-[var(--edr-surface)]/10 px-3 py-3 text-base uppercase outline-none placeholder:text-[var(--edr-muted)] focus:bg-[var(--edr-surface)]/20"
          />
          <button
            onClick={() => manual.trim() && onDetectedRef.current(manual.trim())}
            disabled={!manual.trim()}
            className="rounded-lg bg-[var(--edr-surface)] px-5 py-3 text-base font-black text-black disabled:opacity-40"
          >
            Usar
          </button>
        </div>
      </div>
    </div>
  );
}
