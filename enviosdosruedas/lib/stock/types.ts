/** Las tres tablas del paso 13, tal cual salen de Supabase. */

export interface StockClient {
  id: string;
  nombre: string;
  prefijo: string;
  sufijo: string;
  contador: number;
  profile_id: string | null;
  activo: boolean;
  created_at: string;
}

export interface StockProduct {
  id: string;
  client_id: string;
  nombre: string;
  codigo: string;
  minimo: number;
  activo: boolean;
  created_at: string;
}

/** Fila de la vista `stock_actual`: el producto con su stock ya sumado. */
export interface StockRow {
  product_id: string;
  client_id: string;
  nombre: string;
  codigo: string;
  minimo: number;
  activo: boolean;
  stock: number;
}

export interface StockMovement {
  id: string;
  client_id: string;
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
