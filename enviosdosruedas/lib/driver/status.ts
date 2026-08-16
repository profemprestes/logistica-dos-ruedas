'use client';

import { supabase } from '@/lib/supabaseClient';
import { errorText } from '@/lib/driver/errors';
import { getFix } from '@/lib/driver/geo';
import type { Shipment } from '@/lib/format';

export type EstadoIntermedio = 'retirado' | 'en_camino';

/**
 * Marca retirado / en camino. Devuelve el envío actualizado o el motivo del
 * rechazo, ya traducido para mostrárselo al repartidor.
 *
 * Va con el GPS, igual que las entregas. Antes estos dos pasos se anotaban con
 * la hora y nada más, así que en el historial de un día se veía dónde entregó
 * pero no dónde retiró — justo el dato que hace falta cuando un comercio
 * discute si el paquete se pasó a buscar.
 *
 * La posición se pide con poco tiempo de espera a propósito: es un extra. Si
 * el GPS tarda, el movimiento se guarda igual sin punto; hacer esperar al
 * repartidor con el paquete en la mano por una coordenada sería al revés de
 * como tiene que ser.
 */

/**
 * Cuánto se espera al GPS antes de mandar el movimiento igual.
 *
 * ERAN SEIS SEGUNDOS Y SE NOTABAN. Reportado desde la calle: tocás "ya lo
 * retiré" y no pasa nada durante unos segundos. Adentro de un comercio, con el
 * GPS frío, se esperaban los seis enteros ANTES de hablarle al servidor —
 * exactamente lo que el comentario de arriba dice que no hay que hacer.
 *
 * Con segundo y medio no se pierde casi nada: mientras el repartidor está
 * conectado, la app toma posición cada 30 segundos, así que el celular casi
 * siempre tiene una fresca a mano y la devuelve al instante. Este tope es sólo
 * para el caso en que no la tenga, y ahí el movimiento se guarda sin punto,
 * que es lo que ya estaba decidido.
 */
const ESPERA_GPS_MS = 1500;

export async function marcarEstado(
  shipmentId: number,
  estado: EstadoIntermedio,
): Promise<{ shipment?: Shipment; error?: string }> {
  const fix = await getFix(ESPERA_GPS_MS);

  const { data, error } = await supabase.rpc('set_shipment_status', {
    p_shipment_id: shipmentId,
    p_status: estado,
    p_lat: fix?.lat ?? null,
    p_lng: fix?.lng ?? null,
    p_accuracy_m: fix?.accuracy ?? null,
  });

  if (error) {
    console.error('[estado] set_shipment_status falló', {
      shipmentId,
      estado,
      code: error.code,
      message: error.message,
    });
    return { error: errorText(error.message) };
  }

  return { shipment: data as Shipment };
}
