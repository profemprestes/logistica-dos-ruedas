'use client';

import { useEffect, useRef, useState } from 'react';
import CamaraModal from '@/components/driver/CamaraModal';
import { compressPhoto } from '@/lib/driver/photo';

/**
 * Fotos del comprobante: la primera obligatoria y hasta `max` en total.
 *
 * Usa la cámara nativa del celular (`capture="environment"`) en vez de abrir otro
 * stream de video: sale más rápido, enfoca mejor y no pelea con el lector de QR
 * por el uso de la cámara.
 *
 * LA FOTO SE SACA ADENTRO DE LA APP. Abrir la cámara del celular la mandaba al
 * fondo, y ahí Android la mataba para darle memoria: a los repartidores les
 * pasaba dos y tres veces seguidas. Sacándola acá adentro no hay cambio de app
 * y no hay ocasión de matarla. Ver `CamaraModal`.
 *
 * La cámara del celular queda de respaldo, para cuando la de adentro no
 * arranca. Nunca se deja al repartidor sin forma de sacar la foto.
 *
 * Y ELEGIR DE LA GALERÍA sigue siendo un botón aparte: la foto ya sacada con la
 * cámara del celular, o la que mandó el comercio por WhatsApp. Ojo que ésa sí
 * abre otra app, así que ahí el cierre puede seguir pasando — para eso está el
 * borrador que guarda la entrega a medio cargar.
 *
 * El tope de dos no es capricho: cada foto se sube desde la calle, con la señal
 * que haya. Dejar que se saquen diez es garantizar entregas que nunca terminan
 * de subir.
 */
export default function PhotoInput({
  photos,
  onPhotos,
  max = 2,
  etiquetaPrimera = '📷 Sacar foto (obligatoria)',
}: {
  photos: Blob[];
  onPhotos: (photos: Blob[]) => void;
  max?: number;
  /** Qué dice el botón cuando todavía no hay ninguna. */
  etiquetaPrimera?: string;
}) {
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState('');

  /**
   * Espejo de `previews` para poder liberarlas al desmontar sin que el efecto
   * dependa del estado (y se dispare en cada foto, revocando las que están a
   * la vista). Un object URL que no se revoca ocupa memoria hasta cerrar la
   * pestaña, que es justo lo que no sobra en el celular del repartidor.
   */
  const previewsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      previewsRef.current.forEach(URL.revokeObjectURL);
    };
  }, []);

  function aplicar(nuevas: Blob[], urls: string[]) {
    previewsRef.current = urls;
    setPreviews(urls);
    onPhotos(nuevas);
  }

  /** Suma una foto ya lista —venga de donde venga— y la muestra. */
  function agregar(blob: Blob) {
    try {
      aplicar([...photos, blob], [...previewsRef.current, URL.createObjectURL(blob)]);
    } catch (e) {
      console.error('[foto] no se pudo usar la foto', e);
      setAviso('No se pudo tomar la foto. Cerrá alguna app que tengas abierta y probá de nuevo.');
    }
  }

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
    if (!file || photos.length >= max) return;
    setBusy(true);
    setAviso('');

    let blob: Blob = file;
    try {
      blob = await compressPhoto(file);
    } catch (e) {
      console.error('[foto] no se pudo achicar, se guarda la original', e);
      setAviso('El celular no pudo achicar la foto. Se guardó igual, entera: va a tardar más en subir.');
    }

    agregar(blob);
    setBusy(false);
  }

  function quitar(i: number) {
    const url = previewsRef.current[i];
    if (url) URL.revokeObjectURL(url);
    aplicar(
      photos.filter((_, k) => k !== i),
      previewsRef.current.filter((_, k) => k !== i),
    );
  }

  const completo = photos.length >= max;

  return (
    <div>
      {/* El mismo manejador para los dos: lo único que cambia es de dónde sale
          la foto. `capture` es lo que hace que uno abra la cámara derecho. */}
      <input
        ref={camaraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = ''; // permite volver a elegir la misma foto
        }}
      />

      <input
        ref={galeriaRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {previews.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          {previews.map((url, i) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- es un blob local, no una URL optimizable */}
              <img
                src={url}
                alt={`Comprobante ${i + 1}`}
                className="h-40 w-full rounded-xl border-2 border-[var(--edr-border)] object-cover"
              />
              <button
                type="button"
                onClick={() => quitar(i)}
                aria-label={`Borrar foto ${i + 1}`}
                className="absolute right-1 top-1 rounded-lg bg-black/70 px-3 py-1.5 text-lg font-black leading-none text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {!completo && (
        <button
          type="button"
          onClick={() => setCamaraAbierta(true)}
          disabled={busy}
          className={`w-full rounded-xl px-4 py-5 text-lg font-black active:scale-[0.99] disabled:opacity-60 ${
            photos.length > 0
              ? 'border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] text-[var(--edr-yellow)]'
              : 'bg-[var(--edr-blue)] text-white'
          }`}
        >
          {busy
            ? 'Procesando foto…'
            : photos.length > 0
              ? '📷 Agregar otra foto (opcional)'
              : etiquetaPrimera}
        </button>
      )}

      {!completo && (
        <button
          type="button"
          onClick={() => galeriaRef.current?.click()}
          disabled={busy}
          className="mt-2 w-full rounded-xl border-2 border-[var(--edr-border)] px-4 py-3 text-base font-bold text-[var(--edr-muted)] active:scale-[0.99] disabled:opacity-60"
        >
          🖼️ Elegir de la galería
        </button>
      )}

      {completo && (
        <p className="text-center text-sm font-bold text-[var(--edr-muted)]">
          {max} fotos, el máximo. Tocá la × de una para cambiarla.
        </p>
      )}

      {aviso && (
        <p className="mt-2 rounded-xl bg-amber-400 px-3 py-2 text-center text-sm font-bold text-black">
          {aviso}
        </p>
      )}

      {camaraAbierta && (
        <CamaraModal
          onFoto={(foto) => {
            // Ya sale de la cámara achicada al tamaño final: pasarla otra vez
            // por el compresor sería decodificarla de nuevo para nada.
            agregar(foto);
            setCamaraAbierta(false);
          }}
          onCerrar={() => setCamaraAbierta(false)}
          onSinCamara={() => {
            setCamaraAbierta(false);
            camaraRef.current?.click();
          }}
        />
      )}
    </div>
  );
}
