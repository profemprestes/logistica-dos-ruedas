/**
 * Chequeo de permisos de la app del repartidor.
 *
 * Regla: se bloquea SÓLO si el permiso está denegado o el aparato no lo tiene.
 * Que el GPS no enganche señal adentro de un local no es motivo para bloquear:
 * el permiso está dado y afuera va a andar.
 */

export type PermissionCheck = {
  granted: boolean;
  /** Qué mostrarle al repartidor cuando no está dado. */
  detail: string;
};

const OK: PermissionCheck = { granted: true, detail: '' };

/**
 * Pide la cámara y la apaga en el acto: acá sólo nos interesa el permiso.
 * Si no se apagara, el celular queda con la luz de la cámara prendida y comiendo batería.
 */
export async function checkCamera(): Promise<PermissionCheck> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { granted: false, detail: 'Este navegador no puede usar la cámara. Usá Chrome.' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
    });
    stream.getTracks().forEach((track) => track.stop());
    return OK;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { granted: false, detail: 'Bloqueaste la cámara. Habilitala en los permisos del sitio.' };
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { granted: false, detail: 'No encontramos la cámara trasera de este celular.' };
    }
    return { granted: false, detail: 'La cámara está ocupada por otra app. Cerrala y reintentá.' };
  }
}

/**
 * Dispara el pedido de ubicación. Sólo un "denegado" explícito bloquea:
 * un timeout o una señal pobre no.
 */
export function checkGeolocation(): Promise<PermissionCheck> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ granted: false, detail: 'Este celular no tiene GPS disponible.' });
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(OK),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          resolve({
            granted: false,
            detail: 'Bloqueaste la ubicación. Habilitala en los permisos del sitio.',
          });
        } else {
          // Sin señal todavía, pero el permiso está: lo dejamos pasar.
          resolve(OK);
        }
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}
