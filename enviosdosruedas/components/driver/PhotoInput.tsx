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
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  /**
   * Si achicar la foto falla —típicamente por memoria, en un celular con la
   * cámara y el Maps abiertos— se guarda la original.
   *
   * Antes esto tenía `try/finally` sin `catch`: el botón dejaba de decir
   * "Procesando…" y no pasaba nada más. Ni foto ni mensaje. El repartidor no
   * tenía forma de saber que había que reintentar. Una foto pesada tarda más
   * en subir, pero se sube; una foto perdida no se recupera nunca.
   */
  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setAviso('');

    let blob: Blob = file;
    try {
      blob = await compressPhoto(file);
    } catch (e) {
      console.error('[foto] no se pudo achicar, se guarda la original', e);
      setAviso('El celular no pudo achicar la foto. Se guardó igual, entera: va a tardar más en subir.');
    }

    try {
      setPreview(URL.createObjectURL(blob));
      onPhoto(blob);
    } catch (e) {
      console.error('[foto] no se pudo usar la foto', e);
      setAviso('No se pudo tomar la foto. Cerrá alguna app que tengas abierta y probá de nuevo.');
      onPhoto(null);
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

      {aviso && (
        <p className="mt-2 rounded-xl bg-amber-400 px-3 py-2 text-center text-sm font-bold text-black">
          {aviso}
        </p>
      )}
    </div>
  );
}
