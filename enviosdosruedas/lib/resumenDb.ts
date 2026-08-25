/**
 * Guardar y traer resúmenes. Lo que antes era `localStorage` en una sola PC.
 */
import { supabase } from '@/lib/supabaseClient';
import { esShippy, type Ajustes, type Totales } from '@/lib/resumen';
import type { PedidoPegado } from '@/lib/resumenParse';
import { customRange, logCash, conLosMovimientos, valorDelEnvio, type DeliveryLog } from '@/lib/settlement';

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

/** Arma el renglón del resumen a partir de un movimiento y lo que recaudó. */
function renglon(log: DeliveryLog, cobrar: number, envio: number, nota = ''): PedidoPegado {
  const comercio = (log.shipment?.client_name_raw || 'GENERAL').toUpperCase();
  const shippy = esShippy(comercio);
  return {
    tempId: crypto.randomUUID(),
    comercio: shippy ? 'SHIPPY' : comercio,
    comercioOriginal: comercio,
    descripcion: (log.shipment?.address_street ?? '') + nota,
    cobrar,
    envio,
    esShippy: shippy,
    shipmentId: log.shipment?.id ?? null,
    productos: [],
  };
}

/**
 * Los envíos que el repartidor movió en el período, como renglones del resumen.
 *
 * Sale de `delivery_logs` y no de `shipments` porque lo que se liquida es lo
 * que pasó, con la plata que efectivamente entró: `logCash` es la misma cuenta
 * que usa el cierre de caja, así que los dos números no pueden separarse.
 *
 * OJO CON EL RETIRO. En los envíos "cobrar al retirar" el repartidor le cobra
 * el flete al comercio cuando pasa a buscar el paquete, y esa plata queda
 * anotada en el movimiento de RETIRO, no en el de entrega. Pidiendo sólo las
 * entregas —que es como estaba— esa recaudación no aparecía: con los datos de
 * agosto eran $12.900 que faltaban en la caja del día sin que nada avisara.
 */
export async function traerDelSistema(
  driverId: string,
  desde: string,
  hasta: string,
): Promise<PedidoPegado[]> {
  const { from, to } = customRange(desde, hasta);

  const { data, error } = await conLosMovimientos<DeliveryLog[]>((select) =>
    supabase
      .from('delivery_logs')
      .select(select)
      .eq('driver_id', driverId)
      .in('event', ['entregado', 'retirado', 'no_entregado'])
      .gte('happened_at', from)
      .lte('happened_at', to)
      .order('happened_at'),
  );

  if (error) throw new Error(error.message);

  const logs = (data ?? []).filter((l) => l.shipment);

  // Lo cobrado al retirar, por envío.
  const alRetirar = new Map<number, { monto: number; log: DeliveryLog }>();
  for (const l of logs) {
    if (l.event !== 'retirado') continue;
    const monto = logCash(l);
    if (monto <= 0) continue;
    const id = l.shipment!.id;
    const previo = alRetirar.get(id);
    alRetirar.set(id, { monto: (previo?.monto ?? 0) + monto, log: l });
  }

  // Una entrega por envío: si se cerró como no entregado y después se corrigió,
  // quedan dos movimientos en el historial y vale el último.
  const entregas = new Map<number, DeliveryLog>();
  for (const l of logs) {
    if (l.event === 'entregado') entregas.set(l.shipment!.id, l);
  }

  const renglones = [...entregas.values()].map((l) =>
    renglon(
      l,
      logCash(l) + (alRetirar.get(l.shipment!.id)?.monto ?? 0),
      // El valor EFECTIVO: un Shippy o Conectta cargado sin valor vale el
      // acordado. Los renglones de más abajo (fallidos, cobrado sin entregar)
      // siguen en cero a propósito: ahí el monto es una decisión humana.
      valorDelEnvio(l),
    ),
  );

  /*
   * Cobró al retirar pero el envío todavía no se entregó (o se entregó fuera
   * del período). La plata la tiene igual, así que el renglón va: si no, la
   * rendición cierra corta y nadie se entera hasta contar la caja.
   *
   * El valor del envío queda en cero a propósito. Que se le pague el flete de
   * algo que todavía no entregó es una decisión que no me corresponde tomar
   * sola: el renglón queda a la vista, marcado, y se completa a mano.
   */
  for (const [shipmentId, { monto, log }] of alRetirar) {
    if (entregas.has(shipmentId)) continue;
    renglones.push(renglon(log, monto, 0, ' (cobrado al retirar, sin entregar)'));
  }

  /*
   * Los intentos fallidos: el repartidor fue hasta la puerta.
   *
   * Van con el envío en CERO, igual que los de arriba y por el mismo motivo:
   * el viaje se hizo, pero si se paga o no depende de por qué falló. Que el
   * cliente estuviera ausente no es lo mismo que una dirección mal escrita, y
   * esa diferencia no la puede decidir una cuenta automática. El renglón queda
   * a la vista y marcado; poner el monto —o borrarlo— es una decisión de quien
   * liquida.
   *
   * Si el mismo envío terminó entregándose en el período, no va: sería cobrar
   * dos veces el mismo destino.
   */
  const fallidos = new Map<number, DeliveryLog>();
  for (const l of logs) {
    if (l.event === 'no_entregado') fallidos.set(l.shipment!.id, l);
  }

  for (const [shipmentId, log] of fallidos) {
    if (entregas.has(shipmentId)) continue;
    // El motivo va en el renglón: es justamente el dato con el que se decide.
    renglones.push(
      renglon(log, 0, 0, ` (NO ENTREGADO: ${log.failure_reason ?? 'sin motivo'} — ¿se paga la visita?)`),
    );
  }

  return renglones;
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
