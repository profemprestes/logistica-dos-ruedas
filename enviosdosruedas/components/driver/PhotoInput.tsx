'use client';

import { useEffect, useRef, useState } from 'react';
import { compressPhoto } from '@/lib/driver/photo';

/**
 * Foto del comprobante.
 *
 * Usa la cámara nativa del celular (`capture="environment"`) en vez de abrir otro
 * stream de video: sale más rápido, enfoca mejor y no pelea con el lector de QR
 * por el uso de la cámara.
 */
export default function PhotoInput({
  photo,
  onPhoto,
}: {
  photo: Blob | null;
  onPhoto: (photo: Blob | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await compressPhoto(file);
      setPreview(URL.createObjectURL(blob));
      onPhoto(blob);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = ''; // permite volver a elegir la misma foto
        }}
      />

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- es un blob local, no una URL optimizable
        <img
          src={preview}
          alt="Comprobante"
          className="mb-2 h-44 w-full rounded-xl border-2 border-[var(--edr-border)] object-cover"
        />
      )}

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className={`w-full rounded-xl px-4 py-5 text-lg font-black active:scale-[0.99] disabled:opacity-60 ${
          photo
            ? 'border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] text-[var(--edr-yellow)]'
            : 'bg-[var(--edr-blue)] text-white'
        }`}
      >
        {busy ? 'Procesando foto…' : photo ? '📷 Sacar otra foto' : '📷 Sacar foto (obligatoria)'}
      </button>
    </div>
  );
}
