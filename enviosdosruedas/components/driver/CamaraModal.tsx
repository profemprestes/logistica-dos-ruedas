'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';

/**
 * Cámara adentro de la app.
 *
 * POR QUÉ EXISTE. Abrir la cámara del celular manda la app al fondo, y ahí
 * Android la puede matar para darle memoria a la cámara. A los repartidores les
 * pasaba dos y tres veces seguidas. Sacando la foto acá adentro no hay cambio
 * de app, así que no hay ocasión de matarla: el problema se corta de raíz.
 *
 * LO QUE SE PIERDE, y está bien perderlo: la cámara del celular enfoca mejor,
 * tiene HDR y saca más resolución. Acá sale un cuadro del video, más pobre.
 * Para lo que tiene que probar —el paquete en la puerta, quién firmó— alcanza
 * de sobra, y la foto terminaba achicada a 1280 px igual.
 *
 * Si la cámara no arranca —permiso denegado, otra app la tiene tomada, un
 * navegador viejo— no se deja al repartidor a pie: se ofrece volver a la
 * cámara del celular, que es como venía funcionando.
 */

/** El mismo tamaño al que se achicaban las fotos antes. Ver `lib/driver/photo`. */
const MAX_LADO = 1280;
const CALIDAD = 0.7;

export default function CamaraModal({
  onFoto,
  onCerrar,
  onSinCamara,
}: {
  onFoto: (foto: Blob) => void;
  onCerrar: () => void;
  /** "No pude: abrí la del celular". */
  onSinCamara: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState('');
  const [sacando, setSacando] = useState(false);

  useEffect(() => {
    let cerrado = false;
    let stream: MediaStream | null = null;

    /*
     * El arranque es asíncrono y el repartidor puede cerrar antes de que
     * termine. Por eso el apagado se encadena a la promesa en vez de correr
     * suelto: si no, el `stop()` no encuentra nada que apagar y la cámara queda
     * prendida comiendo batería. Es el mismo cuidado que tiene el lector de QR.
     */
    const arranque = navigator.mediaDevices
      ?.getUserMedia({
        // `ideal` y no `exact`: si el celular no tiene trasera, preferimos que
        // abra la frontal antes que fallar.
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then(async (s) => {
        stream = s;
        if (cerrado) return;

        const v = videoRef.current;
        if (!v) return;

        v.srcObject = s;
        await v.play();
        if (!cerrado) setListo(true);
      })
      .catch((err: unknown) => {
        const nombre = err instanceof DOMException ? err.name : '';
        setError(
          nombre === 'NotAllowedError' || nombre === 'SecurityError'
            ? 'La cámara está bloqueada para este sitio.'
            : nombre === 'NotFoundError' || nombre === 'OverconstrainedError'
              ? 'No encontramos la cámara de este celular.'
              : 'La cámara está ocupada por otra app.',
        );
      });

    return () => {
      cerrado = true;
      void arranque?.finally(() => {
        stream?.getTracks().forEach((t) => t.stop());
      });
    };
  }, []);

  /** Congela un cuadro del video y lo devuelve ya achicado. */
  function sacar() {
    const v = videoRef.current;
    if (!v || sacando) return;

    setSacando(true);

    try {
      const escala = Math.min(1, MAX_LADO / Math.max(v.videoWidth, v.videoHeight));
      const ancho = Math.round(v.videoWidth * escala);
      const alto = Math.round(v.videoHeight * escala);

      const canvas = document.createElement('canvas');
      canvas.width = ancho;
      canvas.height = alto;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setSacando(false);
        setError('Este celular no pudo procesar la foto.');
        return;
      }

      ctx.drawImage(v, 0, 0, ancho, alto);

      canvas.toBlob(
        (blob) => {
          // El canvas se suelta enseguida: en un celular justo de memoria,
          // dejarlo colgando hasta que pase el recolector es plata en la calle.
          canvas.width = 0;
          canvas.height = 0;

          setSacando(false);
          if (!blob) return setError('No se pudo guardar la foto. Probá de nuevo.');

          navigator.vibrate?.(60);
          onFoto(blob);
        },
        'image/jpeg',
        CALIDAD,
      );
    } catch {
      setSacando(false);
      setError('No se pudo sacar la foto. Probá de nuevo.');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      <header className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-base font-bold">
          {error ? 'Cámara' : listo ? 'Encuadrá y sacá la foto' : 'Abriendo la cámara…'}
        </span>
        <button
          onClick={onCerrar}
          className="rounded-lg bg-white/20 px-4 py-2 text-base font-bold text-white"
        >
          Volver
        </button>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
        />

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
            <p className="text-lg font-black text-white">{error}</p>
            <button
              onClick={onSinCamara}
              className="w-full max-w-xs rounded-full bg-[var(--edr-yellow)] px-6 py-4 font-bebas text-xl tracking-[.06em] text-[var(--edr-blue)]"
            >
              Usar la cámara del celular
            </button>
            <p className="text-sm text-white/70">
              Anda igual, pero puede cerrarse la app al volver.
            </p>
          </div>
        )}
      </div>

      {!error && (
        <div className="px-6 pb-8 pt-4">
          <button
            onClick={sacar}
            disabled={!listo || sacando}
            className="w-full rounded-2xl bg-white px-6 py-6 text-2xl font-black text-black active:scale-[0.99] disabled:opacity-50"
          >
            {sacando ? (
              'Guardando…'
            ) : (
              <span className="flex items-center justify-center gap-2">
                <Camera size={28} strokeWidth={2} />
                SACAR FOTO
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
