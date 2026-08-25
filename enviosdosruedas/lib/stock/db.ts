import { supabase } from '@/lib/supabaseClient';
import type { ComercioConStock, MovementRow, StockMovement, StockProduct, StockRow } from './types';

/**
 * Todas las consultas de stock en un solo lugar. Las pantallas sólo arman la
 * vista: si mañana cambia una tabla, se toca acá y nada más.
 *
 * Las políticas del paso 56 hacen el filtro por comercio solas (cada uno ve
 * únicamente lo suyo), así que las mismas funciones sirven para el panel y
 * para el portal del comercio.
 */

/** El aviso que las pantallas muestran cuando la base todavía es la vieja. */
export const FALTA_PASO_56 =
  'Falta correr el paso 56 en la base. Hasta entonces el stock sigue con las tablas viejas.';

/**
 * Los comercios que guardan mercadería acá: los de `clients` con la marca
 * prendida. La marca se pone en la ficha del comercio, no en esta pantalla.
 */
export async function fetchComerciosConStock(): Promise<ComercioConStock[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name')
    .eq('maneja_stock', true)
    .eq('active', true)
    .order('name');

  if (error) {
    throw new Error(/maneja_stock/.test(error.message) ? FALTA_PASO_56 : error.message);
  }
  return (data ?? []) as ComercioConStock[];
}

/** El stock de hoy sale de la vista: se calcula sumando movimientos. */
export async function fetchStock(clientId: number): Promise<StockRow[]> {
  const { data, error } = await supabase
    .from('stock_actual')
    .select('*')
    .eq('client_id', clientId)
    .order('nombre');
  if (error) throw new Error(error.message);
  return (data ?? []) as StockRow[];
}

export async function fetchMovements(clientId: number, limit = 300): Promise<MovementRow[]> {
  const { data, error } = await supabase
    .from('stock_movements')
    .select('*, stock_products(nombre, codigo)')
    .eq('client_id', clientId)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  type Joined = StockMovement & { stock_products: { nombre: string; codigo: string } | null };
  return ((data ?? []) as Joined[]).map((m) => ({
    ...m,
    producto: m.stock_products?.nombre ?? '(producto eliminado)',
    codigo: m.stock_products?.codigo ?? '',
  }));
}

/**
 * Pide el próximo código al servidor. Es una función `security definer` que
 * incrementa el contador y devuelve el código en una sola operación: si dos
 * personas cargan un producto al mismo tiempo, no salen dos códigos iguales.
 */
export async function nextProductCode(clientId: number): Promise<string> {
  const { data, error } = await supabase.rpc('siguiente_codigo_producto', {
    p_client_id: clientId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface NewProduct {
  clientId: number;
  nombre: string;
  minimo: number;
  stockInicial: number;
  fecha: string;
}

export async function createProduct(p: NewProduct): Promise<StockProduct> {
  const codigo = await nextProductCode(p.clientId);

  const { data, error } = await supabase
    .from('stock_products')
    .insert({ client_id: p.clientId, nombre: p.nombre, codigo, minimo: p.minimo })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const producto = data as StockProduct;

  if (p.stockInicial > 0) {
    await addMovement({
      clientId: p.clientId,
      productId: producto.id,
      tipo: 'ingreso',
      cantidad: p.stockInicial,
      fecha: p.fecha,
      nota: 'Stock inicial',
    });
  }

  return producto;
}

export interface NewMovement {
  clientId: number;
  productId: string;
  tipo: 'ingreso' | 'egreso';
  /** Siempre positiva: el signo lo pone `tipo`. */
  cantidad: number;
  fecha: string;
  nota?: string;
  shipmentId?: number | null;
}

export async function addMovement(m: NewMovement): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const { error } = await supabase.from('stock_movements').insert({
    client_id: m.clientId,
    product_id: m.productId,
    tipo: m.tipo,
    cantidad: Math.abs(m.cantidad),
    fecha: m.fecha,
    nota: m.nota ?? null,
    shipment_id: m.shipmentId ?? null,
    created_by: session.session?.user.id ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Devuelve los ids insertados: con eso la pantalla puede ofrecer "deshacer". */
export async function addMovements(list: NewMovement[]): Promise<string[]> {
  if (!list.length) return [];
  const { data: session } = await supabase.auth.getSession();
  const by = session.session?.user.id ?? null;

  const { data, error } = await supabase
    .from('stock_movements')
    .insert(
      list.map((m) => ({
        client_id: m.clientId,
        product_id: m.productId,
        tipo: m.tipo,
        cantidad: Math.abs(m.cantidad),
        fecha: m.fecha,
        nota: m.nota ?? null,
        shipment_id: m.shipmentId ?? null,
        created_by: by,
      }))
    )
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

export async function deleteMovement(id: string): Promise<void> {
  const { error } = await supabase.from('stock_movements').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Deshace una descarga entera: las unidades vuelven al stock. */
export async function deleteMovements(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('stock_movements').delete().in('id', ids);
  if (error) throw new Error(error.message);
}

export async function updateProduct(
  id: string,
  patch: Partial<Pick<StockRow, 'nombre' | 'minimo' | 'activo'>>
): Promise<void> {
  const { error } = await supabase.from('stock_products').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Se lleva los movimientos con él (cascade). Por eso la pantalla lo pregunta. */
export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('stock_products').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/* ------------------------------------------------- el pedido del envío */

/** Una línea del pedido: qué producto lleva el envío y cuántos. */
export interface LineaDePedido {
  productId: string;
  cantidad: number;
}

/**
 * Guarda el pedido de un envío recién cargado. Falla en silencio hacia el
 * caller con el error, que decide si es grave: un envío sin pedido sigue
 * siendo un envío.
 */
export async function guardarPedido(
  shipmentId: number,
  lineas: LineaDePedido[],
): Promise<{ error?: string }> {
  const filas = lineas
    .filter((l) => l.productId && l.cantidad > 0)
    .map((l) => ({ shipment_id: shipmentId, product_id: l.productId, cantidad: l.cantidad }));
  if (!filas.length) return {};

  const { error } = await supabase.from('shipment_products').insert(filas);
  return error ? { error: error.message } : {};
}

/**
 * Reemplaza el pedido de un envío al editarlo: se borra lo viejo y se escribe
 * lo nuevo. Si el envío ya está entregado, el trigger de la base NO recalcula
 * el egreso (el descuento pasó con el pedido que tenía al entregarse): la
 * corrección de un descuento ya hecho se hace en Movimientos, a mano.
 */
export async function reemplazarPedido(
  shipmentId: number,
  lineas: LineaDePedido[],
): Promise<{ error?: string }> {
  const { error: e1 } = await supabase
    .from('shipment_products')
    .delete()
    .eq('shipment_id', shipmentId);
  if (e1) return { error: e1.message };
  return guardarPedido(shipmentId, lineas);
}

/** Los pedidos de varios envíos de una vez, para la edición y los listados. */
export async function fetchPedidos(
  shipmentIds: number[],
): Promise<Map<number, (LineaDePedido & { nombre: string })[]>> {
  const mapa = new Map<number, (LineaDePedido & { nombre: string })[]>();
  if (!shipmentIds.length) return mapa;

  const { data, error } = await supabase
    .from('shipment_products')
    .select('shipment_id, product_id, cantidad, stock_products(nombre)')
    .in('shipment_id', shipmentIds);
  if (error) return mapa; // sin paso 56 no hay pedidos que traer

  type Fila = {
    shipment_id: number;
    product_id: string;
    cantidad: number;
    stock_products: { nombre: string } | { nombre: string }[] | null;
  };
  for (const f of (data ?? []) as Fila[]) {
    const lista = mapa.get(f.shipment_id) ?? [];
    const prod = Array.isArray(f.stock_products) ? f.stock_products[0] : f.stock_products;
    lista.push({ productId: f.product_id, cantidad: f.cantidad, nombre: prod?.nombre ?? '' });
    mapa.set(f.shipment_id, lista);
  }
  return mapa;
}

/* --------------------------------------------------------------- CSV */

/** Descarga en el navegador, sin pasar por el servidor. */
export function downloadCSV(nombre: string, cabeceras: string[], filas: (string | number)[][]) {
  const escapar = (v: string | number) => {
    const s = String(v ?? '');
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = [cabeceras, ...filas].map((f) => f.map(escapar).join(',')).join('\n');
  // El BOM le avisa a Excel que es UTF-8; sin él, los acentos salen rotos.
  const blob = new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
