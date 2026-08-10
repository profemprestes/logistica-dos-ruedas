/**
 * Achica la foto del comprobante antes de guardarla.
 *
 * Una foto de celular pesa 3–5 MB. Multiplicado por 30 entregas sin señal eso
 * revienta la cuota de IndexedDB y después no sube nunca con datos móviles.
 * A 1280 px y calidad 0.7 queda en ~150 KB y se lee perfecto quién firmó.
 */
const MAX_SIDE = 1280;
const QUALITY = 0.7;

export async function compressPhoto(file: File | Blob): Promise<Blob> {
  const bitmap = await createBitmap(file);

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close?.();
    return file; // Sin canvas guardamos el original: peor pesada que perdida.
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY),
  );

  return blob ?? file;
}

/** `imageOrientation` evita que las fotos verticales queden acostadas. */
async function createBitmap(file: File | Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return await createImageBitmap(file);
  }
}
