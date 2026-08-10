'use client';

import { supabase } from '@/lib/supabaseClient';
import { errorText } from '@/lib/driver/errors';
import type { Shipment } from '@/lib/format';

export type EstadoIntermedio = 'retirado' | 'en_camino';

/**
 * Marca retirado / en camino. Devuelve el envío actualizado o el motivo del
 * rechazo, ya traducido para mostrárselo al repartidor.
 */
export async function marcarEstado(
  shipmentId: number,
  estado: EstadoIntermedio,
): Promise<{ shipment?: Shipment; error?: string }> {
  const { data, error } = await supabase.rpc('set_shipment_status', {
    p_shipment_id: shipmentId,
    p_status: estado,
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
