/** Depósito propio: cuando un envío dice "retira en base", es acá. */
export const BASE = 'Friuli 1972, Mar del Plata';

const DICE_BASE = /(base|dep[oó]sito|deposito)/i;

/**
 * Dónde tiene que ir a retirar el repartidor.
 *
 * Los comercios escriben "RETIRA EN BASE" y eso, solo, no le sirve a nadie
 * parado en la moto. Se traduce a la dirección real del depósito.
 */
export function dondeRetira(pickupAddress: string | null | undefined): string {
  const texto = (pickupAddress ?? '').trim();
  if (!texto) return BASE;
  if (DICE_BASE.test(texto) && !/\d/.test(texto)) return BASE;
  return texto;
}
