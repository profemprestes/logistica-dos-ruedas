'use client';

import { useMemo, useState } from 'react';
import { deleteMovement, downloadCSV } from '@/lib/stock/db';
import type { MovementRow, StockClient, StockRow } from '@/lib/stock/types';
import { fechaCorta } from '@/lib/stock/types';
import { btnSmall, field, tableHead, tableWrap } from './ui';

interface Props {
  cliente: StockClient;
  stock: StockRow[];
  movimientos: MovementRow[];
  loading: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
}

export default function MovimientosTab({
  cliente,
  stock,
  movimientos,
  loading,
  onReload,
  onError,
}: Props) {
  const [producto, setProducto] = useState('');
  const [tipo, setTipo] = useState<'' | 'ingreso' | 'egreso'>('');

  const filtrados = useMemo(
    () =>
      movimientos.filter(
        (m) => (!producto || m.product_id === producto) && (!tipo || m.tipo === tipo)
      ),
    [movimientos, producto, tipo]
  );

  async function borrar(m: MovementRow) {
    if (
      !confirm(
        `¿Borrar este movimiento?\n\n${m.tipo === 'ingreso' ? '+' : '−'}${m.cantidad} de ${m.producto}\n\nEl stock se recalcula solo: vuelve como si nunca hubiese pasado.`
      )
    )
      return;
    onError('');
    try {
      await deleteMovement(m.id);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo borrar el movimiento.');
    }
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Historial de movimientos</h2>
          <p className="text-xs text-[var(--edr-muted)]">
            Todo lo que entró y salió del depósito para {cliente.nombre}. Se muestran los últimos 300.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select className={`${field} w-auto`} value={producto} onChange={(e) => setProducto(e.target.value)}>
            <option value="">Todos los productos</option>
            {stock.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.nombre}
              </option>
            ))}
          </select>

          <select
            className={`${field} w-auto`}
            value={tipo}
            onChange={(e) => setTipo(e.target.value as '' | 'ingreso' | 'egreso')}
          >
            <option value="">Entradas y salidas</option>
            <option value="ingreso">Solo entradas</option>
            <option value="egreso">Solo salidas</option>
          </select>

          <button
            onClick={() =>
              downloadCSV(
                `movimientos-${cliente.nombre}.csv`,
                ['Fecha', 'Producto', 'Código', 'Tipo', 'Cantidad', 'Detalle'],
                filtrados.map((m) => [
                  m.fecha,
                  m.producto,
                  m.codigo,
                  m.tipo === 'ingreso' ? 'Entrada' : 'Salida',
                  m.tipo === 'ingreso' ? m.cantidad : -m.cantidad,
                  m.nota ?? '',
                ])
              )
            }
            className={btnSmall}
          >
            Descargar CSV
          </button>
        </div>
      </div>

      <div className={tableWrap}>
        <table className="w-full text-sm">
          <thead className={tableHead}>
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Producto</th>
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2 text-right">Cantidad</th>
              <th className="px-3 py-2">Detalle</th>
              <th className="px-3 py-2 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                  Cargando…
                </td>
              </tr>
            )}

            {!loading && filtrados.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                  Sin movimientos por ahora.
                </td>
              </tr>
            )}

            {filtrados.map((m) => (
              <tr
                key={m.id}
                className="border-b border-[var(--edr-border)] last:border-0 hover:bg-[var(--edr-surface-2)]"
              >
                <td className="edr-mono px-3 py-2 whitespace-nowrap">{fechaCorta(m.fecha)}</td>
                <td className="px-3 py-2 font-semibold">{m.producto}</td>
                <td className="edr-mono px-3 py-2 text-xs">{m.codigo}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${
                      m.tipo === 'ingreso'
                        ? 'bg-emerald-950 text-emerald-200 ring-emerald-400'
                        : 'bg-amber-950 text-amber-200 ring-amber-400'
                    }`}
                  >
                    {m.tipo === 'ingreso' ? 'Entrada' : 'Salida'}
                  </span>
                </td>
                <td className="edr-mono px-3 py-2 text-right font-bold">
                  {m.tipo === 'ingreso' ? '+' : '−'}
                  {m.cantidad}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--edr-muted)]">{m.nota || '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => borrar(m)}
                    className="rounded border border-red-400 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-950"
                  >
                    Borrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
