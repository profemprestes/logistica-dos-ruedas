/**
 * Achica la foto del comprobante antes de guardarla.
 *
 * Una foto de celular pesa 3–5 MB. Multiplicado por 30 entregas sin señal eso
 * revienta la cuota de IndexedDB y después no sube nunca con datos móviles.
 * A 1280 px y calidad 0.7 queda en ~150 KB y se lee perfecto quién firmó.
 *
 * ¡OJO CON LA MEMORIA! Antes esto decodificaba la foto entera a resolución
 * completa y recién después la achicaba: una de 12 MP ocupa ~48 MB en memoria,
 * y una de 48 MP casi 190 MB. Justo en el momento en que Android le apretó el
 * cinturón al navegador para abrir la cámara. Ahora se le pide al decodificador
 * que la achique MIENTRAS la decodifica (`resizeWidth`/`resizeHeight`), así el
 * bitmap grande no se arma nunca.
 */
const MAX_SIDE = 1280;
const QUALITY = 0.7;

export async function compressPhoto(file: File | Blob): Promise<Blob> {
  const medidas = await medirImagen(file);

  // Se le pide el tamaño final al decodificador. Si el navegador no soporta
  // estas opciones las ignora y abajo se achica igual, en el canvas.
  const opciones: ImageBitmapOptions = { imageOrientation: 'from-image' };
  if (medidas) {
    const escala = Math.min(1, MAX_SIDE / Math.max(medidas.width, medidas.height));
    if (escala < 1) {
      opciones.resizeWidth = Math.round(medidas.width * escala);
      opciones.resizeHeight = Math.round(medidas.height * escala);
      opciones.resizeQuality = 'medium';
    }
  }

  const bitmap = await createBitmap(file, opciones);

  // El tamaño sale del bitmap YA decodificado, no de lo que pedimos: si la
  // foto venía rotada por EXIF, el alto y el ancho vienen dados vuelta y
  // confiar en nuestro cálculo la dejaría estirada.
  const escala = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * escala);
  const height = Math.round(bitmap.height * escala);

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

  // El canvas se libera antes de devolver: en un celular justo de memoria,
  // dejarlo colgando hasta que pase el recolector es plata en la calle.
  canvas.width = 0;
  canvas.height = 0;

  return blob ?? file;
}

/**
 * Cuánto mide la foto, sin comprometerse a quedarse con ella.
 *
 * Devuelve `null` si no se pudo averiguar; en ese caso se decodifica como
 * antes y se achica en el canvas. Nunca tira: que falle la medición no puede
 * costarle el comprobante al repartidor.
 */
function medirImagen(file: File | Blob): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    const terminar = (medidas: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      img.src = '';
      resolve(medidas);
    };

    img.onload = () => terminar({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => terminar(null);
    img.src = url;
  });
}

/** `imageOrientation` evita que las fotos verticales queden acostadas. */
async function createBitmap(file: File | Blob, opciones: ImageBitmapOptions): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, opciones);
  } catch {
    // Algunos navegadores viejos se caen con las opciones de resize.
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return await createImageBitmap(file);
    }
  }
}
