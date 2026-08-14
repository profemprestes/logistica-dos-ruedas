import type { Shipment } from '@/lib/format';

/**
 * El orden de la ruta lo decide el repartidor.
 *
 * El sistema no lo impone a propósito: quién sabe si conviene arrancar por
 * Constitución o dejarla para la vuelta es el que está arriba de la moto, y
 * depende del tránsito, del clima y de dónde le quedan los retiros. Acá sólo
 * se guarda su decisión.
 *
 * Está aparte de la pantalla porque acá vive la parte que se puede romper sin
 * que se note: si mover un envío deja la lista corrida una posición, el error
 * se acumula arrastre tras arrastre y termina en una ruta que no es la que
 * eligió. Separado, se prueba.
 */

/**
 * Ordena los envíos según la lista guardada.
 *
 * Los que no están en la lista —un envío que le asignaron recién— van al final
 * en el orden en que vinieron, sin romper lo que ya había decidido.
 */
export function aplicarOrden(envios: Shipment[], ids: number[]): Shipment[] {
  if (!ids.length) return envios;

  const puesto = new Map(ids.map((id, i) => [id, i]));
  const nuevos = envios.filter((s) => !puesto.has(s.id));
  const conocidos = envios.filter((s) => puesto.has(s.id));

  conocidos.sort((a, b) => (puesto.get(a.id) ?? 0) - (puesto.get(b.id) ?? 0));

  return [...conocidos, ...nuevos];
}

/**
 * Mueve un envío a la posición de otro. Devuelve la lista de ids resultante.
 *
 * ¡OJO, ACÁ ESTÁ LA TRAMPA! El navegador puede disparar el `drop` más de una
 * vez por un mismo arrastre. Por eso la cuenta se hace SIEMPRE contra `base`
 * —una foto del orden sacada al empezar a arrastrar— y no contra el orden
 * vivo. Calculando sobre el vivo, el segundo disparo mueve la tarjeta otra
 * posición, y el repartidor ve que la fila "se le corre sola".
 *
 * Hecho así, repetir la misma operación da el mismo resultado.
 */
export function moverEncima(base: number[], id: number, hastaId: number): number[] {
  if (id === hastaId) return base;

  const destino = base.indexOf(hastaId);
  if (destino === -1 || !base.includes(id)) return base;

  const sinEl = base.filter((x) => x !== id);
  // El índice se busca en la lista YA sin el que se mueve: si no, arrastrar
  // hacia abajo lo deja siempre una posición antes de donde se soltó.
  const donde = sinEl.indexOf(hastaId);
  const corrimiento = base.indexOf(id) < destino ? 1 : 0;

  return [...sinEl.slice(0, donde + corrimiento), id, ...sinEl.slice(donde + corrimiento)];
}

/** Sube o baja un envío un lugar. Es lo que hacen las flechas. */
export function moverUno(ids: number[], id: number, direccion: -1 | 1): number[] {
  const i = ids.indexOf(id);
  const j = i + direccion;
  if (i === -1 || j < 0 || j >= ids.length) return ids;

  const copia = [...ids];
  [copia[i], copia[j]] = [copia[j], copia[i]];
  return copia;
}
