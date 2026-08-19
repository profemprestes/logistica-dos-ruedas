'use client';

import { supabase } from '@/lib/supabaseClient';

/**
 * Los pedidos de cambio de datos de un comercio.
 *
 * El comercio no edita su ficha: PIDE. La dirección de retiro no es un dato
 * suyo, es a dónde mandamos una moto todos los días, y un error de tipeo un
 * domingo a la noche manda al repartidor a otra cuadra el lunes a la mañana.
 * Un pedido que espera una confirmación no puede hacer eso.
 *
 * Las reglas de verdad están en la base (paso 51): acá sólo viven las
 * consultas, para que la pantalla del comercio y la de la oficina hablen de lo
 * mismo con las mismas palabras.
 */

export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada';

export interface Solicitud {
  id: number;
  client_id: number;
  phone: string | null;
  pickup_address: string | null;
  pickup_extra: string | null;
  pickup_notes: string | null;
  pickup_window: string | null;
  nota: string | null;
  estado: EstadoSolicitud;
  creada_at: string;
  resuelta_at: string | null;
  motivo: string | null;
  /** El nombre del comercio, cuando la consulta lo pide (la usa la oficina). */
  comercio?: { name: string } | null;
}

/** Lo que un comercio puede pedir que se le cambie. */
export const CAMPOS_PEDIBLES = [
  'phone',
  'pickup_address',
  'pickup_extra',
  'pickup_notes',
  'pickup_window',
] as const;

export type CampoPedible = (typeof CAMPOS_PEDIBLES)[number];

/** Cómo se llama cada campo en pantalla. Uno solo para los dos lados. */
export const NOMBRE_CAMPO: Record<CampoPedible, string> = {
  phone: 'Teléfono',
  pickup_address: 'Dirección de retiro',
  pickup_extra: 'Piso / depto / local',
  pickup_notes: 'Notas de retiro',
  pickup_window: 'Horario de retiro',
};

const COLUMNAS =
  'id, client_id, phone, pickup_address, pickup_extra, pickup_notes, pickup_window, nota, estado, creada_at, resuelta_at, motivo';

/**
 * El pedido que el comercio tiene esperando, si tiene.
 *
 * Uno solo: la base no deja más de un pendiente por comercio, justamente para
 * que "el pedido" no sea una lista de intenciones que se contradicen.
 */
export async function miSolicitudPendiente(clientId: number): Promise<Solicitud | null> {
  const { data } = await supabase
    .from('solicitudes_comercio')
    .select(COLUMNAS)
    .eq('client_id', clientId)
    .eq('estado', 'pendiente')
    .maybeSingle();

  return (data as Solicitud) ?? null;
}

/**
 * El último pedido resuelto, para poder decirle cómo le fue.
 *
 * Sin esto, un pedido rechazado desaparece sin dejar rastro y el comercio
 * vuelve a pedir lo mismo la semana que viene sin saber por qué no salió.
 */
export async function miUltimaResuelta(clientId: number): Promise<Solicitud | null> {
  const { data } = await supabase
    .from('solicitudes_comercio')
    .select(COLUMNAS)
    .eq('client_id', clientId)
    .neq('estado', 'pendiente')
    .order('resuelta_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Solicitud) ?? null;
}

/** Manda el pedido. Devuelve el error para mostrarlo, o null si salió. */
export async function pedirCambio(
  clientId: number,
  valores: Partial<Record<CampoPedible, string>> & { nota?: string },
): Promise<string | null> {
  const { data: sesion } = await supabase.auth.getSession();

  const { error } = await supabase.from('solicitudes_comercio').insert({
    client_id: clientId,
    pedida_por: sesion.session?.user?.id ?? null,
    estado: 'pendiente',
    ...valores,
  });

  if (!error) return null;

  // El índice único es el caso esperable: tocó "pedir" dos veces.
  return /solicitudes_una_pendiente|duplicate/i.test(error.message)
    ? 'Ya tenés un pedido esperando. Cancelalo si querés mandar otro.'
    : error.message;
}

/** Se arrepintió antes de que lo miren. */
export async function cancelarPedido(id: number): Promise<string | null> {
  const { error } = await supabase.from('solicitudes_comercio').delete().eq('id', id);
  return error?.message ?? null;
}

/* ------------------------------------------------------------ la oficina */

/** Los pedidos que esperan, el más viejo primero. */
export async function solicitudesPendientes(): Promise<Solicitud[]> {
  const { data } = await supabase
    .from('solicitudes_comercio')
    .select(`${COLUMNAS}, comercio:client_id(name)`)
    .eq('estado', 'pendiente')
    .order('creada_at');

  // PostgREST tipa el embebido como lista aunque sea uno solo; se aplana acá
  // para que la pantalla no tenga que saberlo.
  return ((data ?? []) as unknown as (Omit<Solicitud, 'comercio'> & {
    comercio: { name: string }[] | { name: string } | null;
  })[]).map((s) => ({
    ...s,
    comercio: Array.isArray(s.comercio) ? (s.comercio[0] ?? null) : s.comercio,
  }));
}

/**
 * Aprobar: copia los datos a la ficha y cierra el pedido, todo junto.
 *
 * Va por RPC y no con dos consultas seguidas porque son dos cosas que tienen
 * que pasar las dos o ninguna: a mitad de camino quedaría un pedido diciendo
 * "pendiente" con los datos ya aplicados, o una ficha vieja con el pedido
 * cerrado.
 */
export async function aprobar(id: number): Promise<string | null> {
  const { error } = await supabase.rpc('aprobar_solicitud_comercio', { p_id: id });
  return error?.message ?? null;
}

export async function rechazar(id: number, motivo: string): Promise<string | null> {
  const { data: sesion } = await supabase.auth.getSession();
  const { error } = await supabase
    .from('solicitudes_comercio')
    .update({
      estado: 'rechazada',
      motivo: motivo.trim() || null,
      resuelta_at: new Date().toISOString(),
      resuelta_por: sesion.session?.user?.id ?? null,
    })
    .eq('id', id);

  return error?.message ?? null;
}

/**
 * Qué cambia de verdad este pedido, contra lo que hay hoy en la ficha.
 *
 * El comercio manda el formulario entero, así que casi siempre viene todo
 * repetido menos una cosa. Mostrar los cinco campos obligaría a comparar de
 * memoria cuál se movió; mostrar sólo el que cambió es la pregunta que hay que
 * contestar para aprobar.
 */
export function loQueCambia(
  s: Solicitud,
  ficha: Partial<Record<CampoPedible, string | null>>,
): { campo: CampoPedible; antes: string; ahora: string }[] {
  const cambios: { campo: CampoPedible; antes: string; ahora: string }[] = [];

  for (const campo of CAMPOS_PEDIBLES) {
    const pedido = (s[campo] ?? '').trim();
    const actual = (ficha[campo] ?? '').trim();
    if (pedido && pedido !== actual) {
      cambios.push({ campo, antes: actual || '(vacío)', ahora: pedido });
    }
  }

  return cambios;
}
