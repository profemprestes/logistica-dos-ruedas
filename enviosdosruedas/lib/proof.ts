import { supabase } from '@/lib/supabaseClient';

/**
 * Piezas compartidas del comprobante de entrega: los tipos, las etiquetas y
 * las descargas. Las usan el modal del panel y el PDF, así los dos cuentan
 * exactamente la misma historia.
 */

export interface ProofLog {
  id: string;
  event: string;
  receiver_name: string | null;
  receiver_dni: string | null;
  failure_reason: string | null;
  comment: string | null;
  photo_path: string | null;
  /** Segunda foto, opcional. Desde el paso 18. */
  photo_path_2: string | null;
  lat: number | null;
  lng: number | null;
  gps_accuracy: number | null;
  amount_collected: number | null;
  happened_at: string;
  created_at: string;
  synced_offline: boolean;
  driver?: { full_name: string } | null;
}

export const EVENT_LABEL: Record<string, string> = {
  creado: 'Creado',
  asignado: 'Asignado',
  retirado: 'Retirado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  no_entregado: 'No entregado',
  reprogramado: 'Reprogramado',
  cancelado: 'Cancelado',
};

export const REASON_LABEL: Record<string, string> = {
  ausente: 'Cliente ausente',
  intransitable: 'Zona intransitable',
  direccion_incorrecta: 'Dirección incorrecta',
  telefono_incorrecto: 'Teléfono incorrecto',
  rechazado: 'Paquete rechazado',
  otro: 'Otro motivo',
};

/** Las fotos viven en un bucket privado: hay que pedir un link temporal. */
export async function signedPhotoUrl(path: string, segundos = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from('delivery-photos').createSignedUrl(path, segundos);
  return data?.signedUrl ?? null;
}

/** Las fotos de un movimiento, en orden. Pueden ser cero, una o dos. */
export function photoPaths(log: ProofLog): string[] {
  return [log.photo_path, log.photo_path_2].filter((p): p is string => Boolean(p));
}

/** `EDR-1234-entregado-2026-08-10.jpg`, para que el archivo se entienda solo. */
export function photoFileName(trackingCode: string, log: ProofLog, indice = 0): string {
  const fecha = log.happened_at.slice(0, 10);
  const path = photoPaths(log)[indice];
  const ext = (path?.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase();
  // La primera se sigue llamando como siempre: los archivos ya bajados no
  // tienen por qué dejar de coincidir con los nuevos.
  const sufijo = indice > 0 ? `-${indice + 1}` : '';
  return `${trackingCode}-${log.event}-${fecha}${sufijo}.${ext}`;
}

/**
 * Baja la foto como archivo.
 *
 * Trae el contenido y lo guarda desde memoria en vez de apuntar el link al
 * navegador: la URL firmada es de otro dominio, y ahí el atributo `download`
 * se ignora (se abre en una pestaña) y además vence en una hora.
 */
export async function downloadPhoto(path: string, fileName: string): Promise<void> {
  const { data, error } = await supabase.storage.from('delivery-photos').download(path);
  if (error || !data) throw new Error(error?.message ?? 'No se pudo bajar la foto.');
  saveBlob(data, fileName);
}

/** Guarda un blob como archivo, sin pasar por el servidor. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Sin esto el blob queda en memoria hasta que se cierre la pestaña.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * El PDF necesita la imagen embebida, no un link: si guardáramos la URL
 * firmada, el archivo dejaría de mostrar la foto en una hora.
 */
export async function photoAsDataUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('delivery-photos').download(path);
  if (!data) return null;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(data);
  });
}

export const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
