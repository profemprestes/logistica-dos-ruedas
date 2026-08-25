'use client';

import { useEffect, useState } from 'react';
import { fetchMovements, fetchStock } from '@/lib/stock/db';
import type { FichaComercio } from '@/components/comercio/ResumenDelComercio';
import type { MovementRow, StockRow } from '@/lib/stock/types';
import { fechaCorta } from '@/lib/stock/types';
import { btnSmall, tableHead, tableWrap } from '@/components/stock/ui';
import { downloadCSV } from '@/lib/stock/db';

/**
 * La mercadería del comercio en nuestro depósito, adentro de su portal.
 *
 * Antes esto era una pantalla aparte (`/stock`) con su propia ficha y su
 * propio usuario; desde el paso 56 el stock cuelga del mismo comercio, así que
 * se mira acá, con la misma sesión con la que mira sus envíos.
 *
 * SÓLO LECTURA a propósito: los ingresos los carga la oficina cuando la
 * mercadería llega de verdad, y los egresos los hace la base sola cuando un
 * envío se entrega. Un número que el comercio pudiera tocar dejaría de servir
 * como verdad compartida.
 *
 * El filtro de verdad no está acá: las políticas del paso 56 sólo le dejan
 * leer las filas de su propia ficha.
 */
export default function MiStock({ comercio }: { comercio: FichaComercio }) {
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovementRow[]>([]);
  const [tab, setTab] = useState<'stock' | 'movimientos'>('stock');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let vivo = true;

    Promise.all([fetchStock(comercio.id), fetchMovements(comercio.id)])
      .then(([s, m]) => {
        if (!vivo) return;
        setStock(s);
        setMovimientos(m);
        setCargando(false);
      })
      .catch((e) => {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar tu stock.');
        setCargando(false);
      });

    return () => {
      vivo = false;
    };
  }, [comercio.id]);

  const unidades = stock.reduce((s, p) => s + p.stock, 0);
  const reponer = stock.filter((p) => p.stock <= p.minimo).length;

  return (
    <main className="mx-auto max-w-4xl px-3 py-5 sm:px-6">
      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {/* Resumen ---------------------------------------------- */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">
            Productos
          </div>
          <div className="edr-mono text-2xl font-black">{stock.length}</div>
        </div>
        <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">
            Unidades
          </div>
          <div className="edr-mono text-2xl font-black">{unidades}</div>
        </div>
        <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">
            Para reponer
          </div>
          <div className={`edr-mono text-2xl font-black ${reponer ? 'text-red-300' : ''}`}>
            {reponer}
          </div>
        </div>
      </div>

      <nav className="mb-5 flex flex-wrap gap-1 border-b border-[var(--edr-border)]">
        {(
          [
            { id: 'stock' as const, label: 'Mi stock' },
            { id: 'movimientos' as const, label: 'Entradas y salidas' },
          ]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px rounded-t px-4 py-2 text-sm font-semibold ${
              tab === t.id
                ? 'border-b-2 border-[var(--edr-yellow)] text-[var(--edr-yellow)]'
                : 'text-[var(--edr-muted)] hover:text-[var(--edr-yellow)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'stock' ? (
        <>
          <div className={tableWrap}>
            <table className="w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className="px-3 py-2">Producto</th>
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2 text-right">Disponible</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {cargando && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                      Cargando…
                    </td>
                  </tr>
                )}

                {!cargando && stock.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                      Todavía no hay productos tuyos en depósito.
                    </td>
                  </tr>
                )}

                {stock.map((p) => {
                  const bajo = p.stock <= p.minimo;
                  return (
                    <tr
                      key={p.product_id}
                      className="border-b border-[var(--edr-border)] last:border-0"
                    >
                      <td className="px-3 py-2 font-semibold">{p.nombre}</td>
                      <td className="edr-mono px-3 py-2 text-xs">{p.codigo}</td>
                      <td
                        className={`edr-mono px-3 py-2 text-right font-bold ${bajo ? 'text-red-300' : ''}`}
                      >
                        {p.stock}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ring-1 ${
                            bajo
                              ? 'bg-red-950 text-red-200 ring-red-400'
                              : 'bg-emerald-950 text-emerald-200 ring-emerald-400'
                          }`}
                        >
                          {bajo ? 'Hay que reponer' : 'Disponible'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {stock.length > 0 && (
            <button
              onClick={() =>
                downloadCSV(
                  'mi-stock.csv',
                  ['Producto', 'Código', 'Disponible'],
                  stock.map((p) => [p.nombre, p.codigo, p.stock]),
                )
              }
              className={`${btnSmall} mt-3`}
            >
              Descargar CSV
            </button>
          )}
        </>
      ) : (
        <div className={tableWrap}>
          <table className="w-full text-sm">
            <thead className={tableHead}>
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                    Sin movimientos por ahora.
                  </td>
                </tr>
              )}

              {movimientos.map((m) => (
                <tr key={m.id} className="border-b border-[var(--edr-border)] last:border-0">
                  <td className="edr-mono whitespace-nowrap px-3 py-2">{fechaCorta(m.fecha)}</td>
                  <td className="px-3 py-2 font-semibold">{m.producto}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
