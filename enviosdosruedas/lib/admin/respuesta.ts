import type { Shipment } from '@/lib/format';
import { trackUrl } from '@/lib/trackUrl';
import type { Estimacion } from '@/lib/eta';

/**
 * La respuesta ya escrita, para copiar y mandar.
 *
 * El buscador del panel no existe para que la oficina se entere: la oficina se
 * entera mirando la tabla. Existe para el momento siguiente, que es el que
 * lleva tiempo — el comercio pregunta por WhatsApp, hay que buscar el envío,
 * mirar en qué anda, y recién ahí escribir una contestación. Lo último es lo
 * que más tarda y lo que peor sale cuando hay apuro.
 *
 * Así que se escribe una sola vez, acá, y sale igual siempre. Con dos reglas:
 *
 *  - El tiempo va SIEMPRE como rango y con "aproximadamente" adelante, igual
 *    que en la página pública. Un "llega en 7 minutos" que no se cumple es
 *    peor que no decir nada.
 *  - Nada de plata, ni teléfono, ni DNI: este texto se le reenvía al
 *    destinatario y termina en un chat que no controlamos.
 */

export interface DatosDeRespuesta {
  envio: Shipment;
  eta: Estimacion | null;
  /** Cuándo se cerró, si ya se cerró. */
  cierre: { event: string; happened_at: string; failure_reason: string | null } | null;
}

/**
 * Los mismos motivos de `lib/proof.ts`, dichos como se le dicen a un cliente.
 * "Cliente ausente" es una casilla de formulario; "no había nadie" es una
 * explicación, y este texto se le reenvía a alguien que está esperando.
 */
const MOTIVO: Record<string, string> = {
  ausente: 'no había nadie',
  intransitable: 'no se pudo llegar hasta la puerta',
  direccion_incorrecta: 'la dirección no coincidía',
  telefono_incorrecto: 'el teléfono no correspondía',
  rechazado: 'no lo quisieron recibir',
  otro: 'no se pudo entregar',
};

function fechaYHora(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `el ${dia}/${mes} a las ${hora}:${min}`;
}

export function respuestaParaElCliente({ envio, eta, cierre }: DatosDeRespuesta): string {
  const donde = [envio.address_street, envio.city].filter(Boolean).join(', ');
  const link = trackUrl(envio.tracking_code);
  const encabezado = `Envío ${envio.tracking_code} — ${donde}.`;

  const cuerpo = (() => {
    switch (envio.status) {
      case 'creado':
      case 'pendiente_retiro':
        return 'Todavía está en el comercio: lo pasamos a buscar y sale a reparto.';

      case 'retirado':
        return 'Ya lo tenemos nosotros y sale a reparto hoy.';

      case 'en_camino':
        return eta
          ? `Va en camino. Llega aproximadamente ${eta.texto.toLowerCase()}.`
          : 'Va en camino, el repartidor está haciendo el recorrido.';

      case 'entregado':
        return cierre
          ? `Ya se entregó ${fechaYHora(cierre.happened_at)}.`
          : 'Ya se entregó.';

      case 'pendiente_entrega':
        return cierre
          ? `Se intentó entregar ${fechaYHora(cierre.happened_at)} y ${
              MOTIVO[cierre.failure_reason ?? 'otro'] ?? MOTIVO.otro
            }. Lo reprogramamos para el próximo día hábil.`
          : 'Se intentó entregar y no se pudo. Lo reprogramamos.';

      case 'cancelado':
        return 'El envío quedó cancelado.';

      default:
        return 'Está en curso.';
    }
  })();

  // El link va siempre menos cuando ya está cerrado y cancelado: ahí no hay
  // nada que seguir y mandarlo invita a entrar a una pantalla que no dice nada.
  const seguir =
    envio.status === 'cancelado' ? '' : `\nPodés seguirlo acá: ${link}`;

  return `${encabezado}\n${cuerpo}${seguir}`;
}

/** Los cinco hitos de la línea de tiempo, siempre los mismos cinco. */
export const HITOS = [
  { evento: 'creado', nombre: 'CARGADO' },
  { evento: 'pendiente_retiro', nombre: 'A RETIRAR' },
  { evento: 'retirado', nombre: 'RETIRADO' },
  { evento: 'en_camino', nombre: 'EN CAMINO' },
  { evento: 'entregado', nombre: 'ENTREGADO' },
] as const;

/**
 * Hasta qué hito llegó el envío.
 *
 * Se resuelve por el estado y no contando movimientos: un envío que se cargó
 * ya retirado —pasa, cuando el comercio lo trae a la oficina— no tiene el
 * movimiento "retirado" en el historial, y la línea de tiempo lo mostraría
 * como si nunca hubiese salido.
 */
export function hastaDonde(envio: Shipment): number {
  switch (envio.status) {
    case 'creado':
      return 0;
    case 'pendiente_retiro':
      return 1;
    case 'retirado':
      return 2;
    case 'en_camino':
      return 3;
    case 'entregado':
      return 4;
    // Un intento fallido llegó hasta la puerta: la línea se pinta entera menos
    // el final, y el final se cuenta aparte porque no fue una entrega.
    case 'pendiente_entrega':
      return 3;
    default:
      return 0;
  }
}
