/**
 * Guardar y traer resúmenes. Lo que antes era `localStorage` en una sola PC.
 */
import { supabase } from '@/lib/supabaseClient';
import { esShippy, type Ajustes, type Totales } from '@/lib/resumen';
import type { PedidoPegado } from '@/lib/resumenParse';
import { customRange, logCash, LOG_SELECT, type DeliveryLog } from '@/lib/settlement';

export type Origen = 'pegado' | 'sistema' | 'mixto';

export interface ResumenGuardado {
  id: number;
  driver_id: string | null;
  driver_name: string;
  desde: string;
  hasta: string;
  origen: Origen;
  pendiente: number;
  rendido: number;
  excluir_efectivo_shippy: boolean;
  envios_normales: number;
  envios_shippy: number;
  efectivo_normal: number;
  efectivo_shippy: number;
  pago_repartidor: number;
  ganancia: number;
  a_rendir: number;
  texto: string | null;
  texto_compacto: string | null;
  created_at: string;
}

/**
 * Los envíos que el repartidor cerró en el período, como renglones del resumen.
 *
 * Sale de `delivery_logs` y no de `shipments` porque lo que se liquida es lo
 * que se entregó, con la plata que efectivamente entró: `logCash` es la misma
 * cuenta que usa el cierre de caja, así que los dos números no pueden
 * separarse.
 */
export async function traerDelSistema(
  driverId: string,
  desde: string,
  hasta: string,
): Promise<PedidoPegado[]> {
  const { from, to } = customRange(desde, hasta);

  const { data, error } = await supabase
    .from('delivery_logs')
    .select(LOG_SELECT)
    .eq('driver_id', driverId)
    .eq('event', 'entregado')
    .gte('happened_at', from)
    .lte('happened_at', to)
    .order('happened_at');

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as DeliveryLog[])
    .filter((l) => l.shipment)
    .map((l) => {
      const comercio = (l.shipment?.client_name_raw || 'GENERAL').toUpperCase();
      const shippy = esShippy(comercio);
      return {
        tempId: crypto.randomUUID(),
        comercio: shippy ? 'SHIPPY' : comercio,
        comercioOriginal: comercio,
        descripcion: l.shipment?.address_street ?? '',
        cobrar: logCash(l),
        envio: Number(l.shipment?.shipping_fee ?? 0),
        esShippy: shippy,
        shipmentId: l.shipment?.id ?? null,
        productos: [],
      };
    });
}

export async function guardarResumen(datos: {
  driverId: string | null;
  driverName: string;
  desde: string;
  hasta: string;
  origen: Origen;
  ajustes: Ajustes;
  totales: Totales;
  pedidos: PedidoPegado[];
  texto: string;
  textoCompacto: string;
}): Promise<number> {
  const { data, error } = await supabase
    .from('driver_summaries')
    .insert({
      driver_id: datos.driverId,
      driver_name: datos.driverName,
      desde: datos.desde,
      hasta: datos.hasta,
      origen: datos.origen,
      pendiente: datos.ajustes.pendiente,
      rendido: datos.ajustes.rendido,
      excluir_efectivo_shippy: datos.ajustes.excluirEfectivoShippy,
      envios_normales: datos.totales.enviosNormales,
      envios_shippy: datos.totales.enviosShippy,
      efectivo_normal: datos.totales.efectivoNormal,
      efectivo_shippy: datos.totales.efectivoShippy,
      pago_repartidor: datos.totales.aPagarTotal,
      ganancia: datos.totales.ganancia,
      a_rendir: datos.totales.aRendir,
      texto: datos.texto,
      texto_compacto: datos.textoCompacto,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'No se pudo guardar el resumen.');

  const summaryId = data.id as number;

  const renglones = datos.pedidos.map((p, i) => ({
    summary_id: summaryId,
    shipment_id: p.shipmentId ?? null,
    comercio: p.comercioOriginal || 'GENERAL',
    descripcion: p.descripcion,
    cobrar: p.cobrar,
    envio: p.envio,
    es_shippy: p.esShippy,
    productos: p.productos.length ? p.productos : null,
    orden: i,
  }));

  const { error: errorItems } = await supabase.from('driver_summary_items').insert(renglones);

  if (errorItems) {
    // Un resumen sin renglones es peor que ninguno: muestra totales que después
    // no se pueden explicar. Se deshace y se avisa.
    await supabase.from('driver_summaries').delete().eq('id', summaryId);
    throw new Error(`Se guardaron los totales pero no el detalle: ${errorItems.message}`);
  }

  return summaryId;
}

export function listarResumenes(desde: string, hasta: string, driverId?: string) {
  let q = supabase
    .from('driver_summaries')
    .select('*')
    .lte('desde', hasta)
    .gte('hasta', desde)
    .order('hasta', { ascending: false })
    .order('id', { ascending: false });

  if (driverId) q = q.eq('driver_id', driverId);
  return q;
}

export async function borrarResumen(id: number): Promise<void> {
  const { error } = await supabase.from('driver_summaries').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** El detalle renglón por renglón de un resumen guardado. */
export function renglonesDe(summaryId: number) {
  return supabase
    .from('driver_summary_items')
    .select('*')
    .eq('summary_id', summaryId)
    .order('orden');
}
