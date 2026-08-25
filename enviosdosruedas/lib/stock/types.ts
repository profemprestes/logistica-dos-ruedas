/** Las tablas del paso 56, tal cual salen de Supabase. */

/**
 * Un comercio que guarda mercadería en el depósito.
 *
 * NO ES UNA TABLA PROPIA: es la fila de `clients` con `maneja_stock` prendido.
 * El paso 13 tenía una lista de clientes de stock aparte de los comercios de
 * verdad, y eran el mismo mundo dos veces; el paso 56 los unificó.
 */
export interface ComercioConStock {
  id: number;
  name: string;
  stock_prefijo: string | null;
  stock_contador: number;
}

export interface StockProduct {
  id: string;
  client_id: number;
  nombre: string;
  codigo: string;
  minimo: number;
  activo: boolean;
  created_at: string;
}

/** Fila de la vista `stock_actual`: el producto con su stock ya sumado. */
export interface StockRow {
  product_id: string;
  client_id: number;
  nombre: string;
  codigo: string;
  minimo: number;
  activo: boolean;
  stock: number;
}

export interface StockMovement {
  id: string;
  client_id: number;
  product_id: string;
  tipo: 'ingreso' | 'egreso';
  cantidad: number;
  fecha: string;
  nota: string | null;
  shipment_id: number | null;
  created_by: string | null;
  created_at: string;
}

/** Movimiento con el nombre del producto ya resuelto, para las tablas. */
export interface MovementRow extends StockMovement {
  producto: string;
  codigo: string;
}

/** Hoy en formato ISO corto, en hora local (no UTC: si no, de noche da ayer). */
export function hoyISO(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function fechaCorta(iso: string): string {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}/${a.slice(2)}` : iso;
}
