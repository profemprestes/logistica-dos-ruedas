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
export async function marcarEstado(
  shipmentId: number,
  estado: EstadoIntermedio,
): Promise<{ shipment?: Shipment; error?: string }> {
  const fix = await getFix(6000);

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
