import { supabase } from '@/lib/supabaseClient';
import type { MovementRow, StockClient, StockMovement, StockProduct, StockRow } from './types';

/**
 * Todas las consultas de stock en un solo lugar. Las pantallas sólo arman la
 * vista: si mañana cambia una tabla, se toca acá y nada más.
 *
 * Las políticas del paso 13 hacen el filtro por cliente solas (el comercio ve
 * únicamente lo suyo), así que las mismas funciones sirven para las dos
 * pantallas.
 */

export async function fetchClients(): Promise<StockClient[]> {
  const { data, error } = await supabase
    .from('stock_clients')
    .select('*')
    .order('nombre');
  if (error) throw new Error(error.message);
  return (data ?? []) as StockClient[];
}

/** El stock de hoy sale de la vista: se calcula sumando movimientos. */
export async function fetchStock(clientId: string): Promise<StockRow[]> {
  const { data, error } = await supabase
    .from('stock_actual')
    .select('*')
    .eq('client_id', clientId)
    .order('nombre');
  if (error) throw new Error(error.message);
  return (data ?? []) as StockRow[];
}

export async function fetchMovements(clientId: string, limit = 300): Promise<MovementRow[]> {
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
export async function nextProductCode(clientId: string): Promise<string> {
  const { data, error } = await supabase.rpc('siguiente_codigo_producto', {
    p_client_id: clientId,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface NewProduct {
  clientId: string;
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
  clientId: string;
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

export async function createClient(c: {
  nombre: string;
  prefijo: string;
  sufijo: string;
}): Promise<StockClient> {
  const { data, error } = await supabase.from('stock_clients').insert(c).select().single();
  if (error) throw new Error(error.message);
  return data as StockClient;
}

export async function updateClient(
  id: string,
  patch: Partial<Pick<StockClient, 'nombre' | 'prefijo' | 'sufijo' | 'activo'>>
): Promise<void> {
  const { error } = await supabase.from('stock_clients').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Se lleva puestos sus productos y todo el historial de movimientos (cascade).
 * Es irreversible: por eso la pantalla lo hace escribir el nombre del cliente.
 */
export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase.from('stock_clients').delete().eq('id', id);
  if (error) throw new Error(error.message);
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
