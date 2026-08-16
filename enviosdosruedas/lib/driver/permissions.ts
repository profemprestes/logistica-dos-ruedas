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
 * Preguntar en vez de probar.
 *
 * EL PROBLEMA QUE RESUELVE. Los dos chequeos de abajo averiguan el permiso
 * USÁNDOLO: prenden la cámara y piden una posición al GPS. Funciona, pero se
 * paga caro en cada arranque —la cámara tarda un segundo o dos y parpadea, y el
 * GPS puede quedarse los quince segundos enteros adentro de un local— y se paga
 * aunque el permiso esté dado desde hace una semana. Reportado desde la calle:
 * "se queda cargando permisos que ya tiene".
 *
 * El navegador sabe la respuesta sin usar nada. Esto se la pide, y contesta en
 * milisegundos.
 *
 * Devuelve null si no se puede saber —el navegador no soporta la consulta, o
 * dice "todavía no se preguntó"— y ahí sí se cae al camino largo, que además es
 * el que hace aparecer el cartel del sistema. Que es justo lo que se quiere la
 * primera vez.
 */
async function yaEstaDado(nombre: 'camera' | 'geolocation'): Promise<PermissionCheck | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;

  try {
    // El tipo de TypeScript no incluye 'camera' aunque los navegadores sí.
    const estado = await navigator.permissions.query({
      name: nombre as PermissionName,
    });

    if (estado.state === 'granted') return OK;

    if (estado.state === 'denied') {
      return {
        granted: false,
        detail:
          nombre === 'camera'
            ? 'Bloqueaste la cámara. Habilitala en los permisos del sitio.'
            : 'Bloqueaste la ubicación. Habilitala en los permisos del sitio.',
      };
    }

    // 'prompt': hay que preguntarle al repartidor, y eso lo hace el camino largo.
    return null;
  } catch {
    // Algunos navegadores tiran error con 'camera'. No es un problema: se
    // averigua como siempre.
    return null;
  }
}

/**
 * Pide la cámara y la apaga en el acto: acá sólo nos interesa el permiso.
 * Si no se apagara, el celular queda con la luz de la cámara prendida y comiendo batería.
 */
export async function checkCamera(): Promise<PermissionCheck> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { granted: false, detail: 'Este navegador no puede usar la cámara. Usá Chrome.' };
  }

  // Si ya está contestado, no hace falta prender nada.
  const sabido = await yaEstaDado('camera');
  if (sabido) return sabido;

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
export async function checkGeolocation(): Promise<PermissionCheck> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { granted: false, detail: 'Este celular no tiene GPS disponible.' };
  }

  /*
   * Acá está la mayor parte de la demora que se sentía al abrir.
   *
   * Pedir una posición para saber si el permiso está dado puede tardar los
   * quince segundos enteros con el GPS frío o adentro de un local, y bloquea
   * la pantalla todo ese rato aunque el permiso esté dado desde siempre.
   */
  const sabido = await yaEstaDado('geolocation');
  if (sabido) return sabido;

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
