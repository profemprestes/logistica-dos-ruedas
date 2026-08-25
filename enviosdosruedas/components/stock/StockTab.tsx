'use client';

import { useMemo, useRef, useState } from 'react';
import {
  addMovement,
  createProduct,
  deleteProduct,
  downloadCSV,
  updateProduct,
  addMovements,
  nextProductCode,
} from '@/lib/stock/db';
import { normalizar, parseCSV } from '@/lib/stock/parse';
import type { ComercioConStock, StockRow } from '@/lib/stock/types';
import { hoyISO } from '@/lib/stock/types';
import { supabase } from '@/lib/supabaseClient';
import { btnGhost, btnPrimary, btnSmall, card, field, labelCls, tableHead, tableWrap } from './ui';

interface Props {
  cliente: ComercioConStock;
  stock: StockRow[];
  loading: boolean;
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

/** Fila de la previa de importación, ya cruzada con lo que hay en el depósito. */
interface ImportRow {
  nombre: string;
  codigo: string;
  cantidad: number;
  minimo: number | null;
  /** Producto existente al que apunta, si lo encontró. */
  existente: StockRow | null;
}

export default function StockTab({ cliente, stock, loading, onReload, onError, onNotice }: Props) {
  const [nombre, setNombre] = useState('');
  const [inicial, setInicial] = useState('0');
  const [minimo, setMinimo] = useState('0');
  const [creando, setCreando] = useState(false);

  /** Cantidad tipeada en la fila de cada producto, para el movimiento rápido. */
  const [rapido, setRapido] = useState<Record<string, string>>({});
  const [trabajando, setTrabajando] = useState('');

  const [editando, setEditando] = useState<StockRow | null>(null);

  const [previa, setPrevia] = useState<ImportRow[] | null>(null);
  const [modo, setModo] = useState<'sumar' | 'reemplazar'>('sumar');
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const totalUnidades = useMemo(() => stock.reduce((s, p) => s + p.stock, 0), [stock]);
  const bajos = useMemo(() => stock.filter((p) => p.stock <= p.minimo).length, [stock]);

  /* ------------------------------------------------------------ alta */

  async function agregar() {
    if (!nombre.trim()) return onError('Poné un nombre de producto.');
    if (stock.some((p) => normalizar(p.nombre) === normalizar(nombre)))
      return onError('Ese cliente ya tiene un producto con ese nombre.');

    setCreando(true);
    onError('');
    try {
      const p = await createProduct({
        clientId: cliente.id,
        nombre: nombre.trim(),
        minimo: Number(minimo) || 0,
        stockInicial: Number(inicial) || 0,
        fecha: hoyISO(),
      });
      onNotice(`Producto cargado con el código ${p.codigo}.`);
      setNombre('');
      setInicial('0');
      setMinimo('0');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo cargar el producto.');
    }
    setCreando(false);
  }

  /* --------------------------------------------- movimiento rápido */

  async function mover(p: StockRow, tipo: 'ingreso' | 'egreso') {
    const cantidad = Math.abs(Number(rapido[p.product_id]) || 0);
    if (!cantidad) return onError('Poné una cantidad mayor a cero.');
    if (tipo === 'egreso' && cantidad > p.stock)
      if (!confirm(`Hay ${p.stock} en depósito y estás sacando ${cantidad}. El stock queda en negativo. ¿Seguís?`))
        return;

    setTrabajando(p.product_id);
    onError('');
    try {
      await addMovement({
        clientId: cliente.id,
        productId: p.product_id,
        tipo,
        cantidad,
        fecha: hoyISO(),
        nota: tipo === 'ingreso' ? 'Entró mercadería' : 'Salida manual',
      });
      setRapido((r) => ({ ...r, [p.product_id]: '' }));
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo registrar el movimiento.');
    }
    setTrabajando('');
  }

  async function guardarEdicion() {
    if (!editando) return;
    onError('');
    try {
      await updateProduct(editando.product_id, {
        nombre: editando.nombre,
        minimo: editando.minimo,
      });
      setEditando(null);
      onNotice('Producto actualizado.');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
  }

  async function borrar(p: StockRow) {
    if (
      !confirm(
        `¿Eliminar "${p.nombre}"?\n\nSe borra también todo su historial de entradas y salidas. Si sólo dejó de venderse, conviene ponerle mínimo 0 y dejarlo en cero.`
      )
    )
      return;
    onError('');
    try {
      await deleteProduct(p.product_id);
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo eliminar.');
    }
  }

  /* --------------------------------------------------- importación */

  function leerArchivo(file: File) {
    onError('');
    const reader = new FileReader();
    reader.onload = () => {
      const filas = parseCSV(String(reader.result ?? ''));
      if (filas.length < 2) return onError('El archivo no tiene filas para importar.');

      // Ubico las columnas por el nombre del encabezado, en cualquier orden.
      const cabecera = filas[0].map((c) => normalizar(c));
      const col = (...nombres: string[]) => cabecera.findIndex((c) => nombres.includes(c));
      const iNombre = col('producto', 'nombre', 'descripcion');
      const iCodigo = col('codigo', 'sku');
      const iCantidad = col('cantidad', 'stock', 'unidades');
      const iMinimo = col('minimo', 'alerta', 'stock minimo');

      if (iNombre < 0 || iCantidad < 0)
        return onError('El archivo necesita al menos las columnas Producto y Cantidad.');

      const rows: ImportRow[] = [];
      for (const f of filas.slice(1)) {
        const nom = (f[iNombre] ?? '').trim();
        if (!nom) continue;
        const cod = iCodigo >= 0 ? (f[iCodigo] ?? '').trim() : '';
        const min = iMinimo >= 0 && f[iMinimo] !== '' ? Number(f[iMinimo]) || 0 : null;

        const existente =
          (cod && stock.find((p) => normalizar(p.codigo) === normalizar(cod))) ||
          stock.find((p) => normalizar(p.nombre) === normalizar(nom)) ||
          null;

        rows.push({
          nombre: nom,
          codigo: cod,
          cantidad: Math.max(0, Math.round(Number(f[iCantidad]) || 0)),
          minimo: min,
          existente,
        });
      }

      if (!rows.length) return onError('No encontré filas con producto.');
      setPrevia(rows);
    };
    reader.readAsText(file, 'utf-8');
  }

  async function confirmarImport() {
    if (!previa) return;
    setImportando(true);
    onError('');
    const fecha = hoyISO();

    try {
      const movimientos: Parameters<typeof addMovements>[0] = [];
      let creados = 0;
      let actualizados = 0;

      for (const r of previa) {
        if (r.existente) {
          if (r.minimo !== null && r.minimo !== r.existente.minimo)
            await updateProduct(r.existente.product_id, { minimo: r.minimo });

          const diferencia = modo === 'reemplazar' ? r.cantidad - r.existente.stock : r.cantidad;
          if (diferencia !== 0)
            movimientos.push({
              clientId: cliente.id,
              productId: r.existente.product_id,
              tipo: diferencia > 0 ? 'ingreso' : 'egreso',
              cantidad: Math.abs(diferencia),
              fecha,
              nota: modo === 'reemplazar' ? 'Importación: ajuste al valor del archivo' : 'Importación de archivo',
            });
          actualizados++;
        } else {
          // Producto nuevo: le pido el código correlativo y lo doy de alta.
          const codigo = await nextProductCode(cliente.id);
          const { data, error } = await supabase
            .from('stock_products')
            .insert({
              client_id: cliente.id,
              nombre: r.nombre,
              codigo,
              minimo: r.minimo ?? 0,
            })
            .select('id')
            .single();
          if (error) throw new Error(error.message);

          if (r.cantidad > 0)
            movimientos.push({
              clientId: cliente.id,
              productId: data.id,
              tipo: 'ingreso',
              cantidad: r.cantidad,
              fecha,
              nota: 'Importación de archivo',
            });
          creados++;
        }
      }

      await addMovements(movimientos);
      onNotice(`Importación lista: ${creados} producto(s) nuevo(s), ${actualizados} actualizado(s).`);
      cancelarImport();
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo importar.');
    }
    setImportando(false);
  }

  function cancelarImport() {
    setPrevia(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  /* ------------------------------------------------------------ vista */

  return (
    <div className="space-y-6">
      {/* Alta -------------------------------------------------------- */}
      <section className={card}>
        <h2 className="mb-1 text-base font-bold">Cargar producto</h2>
        <p className="mb-4 text-xs text-[var(--edr-muted)]">
          El código se genera solo y sigue la misma numeración que los envíos
          (<span className="edr-mono">EDR…MDQ</span>): una sola serie para toda la empresa, sea de
          quien sea el producto.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className={labelCls}>Producto *</label>
            <input
              className={field}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Óxido Nítrico"
            />
          </div>
          <div>
            <label className={labelCls}>Cantidad inicial</label>
            <input className={field} type="number" value={inicial} onChange={(e) => setInicial(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Alerta de stock bajo</label>
            <input className={field} type="number" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
          </div>
          <div className="self-end">
            <button onClick={agregar} disabled={creando} className={`${btnPrimary} w-full`}>
              {creando ? 'Cargando…' : 'Agregar al stock'}
            </button>
          </div>
        </div>
      </section>

      {/* Importación ------------------------------------------------- */}
      <section className={card}>
        <h2 className="mb-1 text-base font-bold">Importar desde archivo</h2>
        <p className="mb-4 text-xs text-[var(--edr-muted)]">
          Subí un CSV con las columnas <strong>Producto</strong> y <strong>Cantidad</strong>; opcionalmente{' '}
          <strong>Código</strong> y <strong>Mínimo</strong>. Si tenés un Excel, guardalo como CSV desde el mismo
          Excel. Antes de tocar nada te muestro fila por fila qué va a pasar.
        </p>

        <div className="flex flex-wrap items-center gap-4">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={(e) => e.target.files?.[0] && leerArchivo(e.target.files[0])}
            className="text-sm text-[var(--edr-muted)] file:mr-3 file:rounded file:border file:border-[var(--edr-border)] file:bg-[var(--edr-surface-2)] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[var(--edr-ink)]"
          />
          <button
            onClick={() =>
              downloadCSV('plantilla-stock.csv', ['Producto', 'Código', 'Cantidad', 'Mínimo'], [
                ['Óxido Nítrico', '', 12, 3],
              ])
            }
            className={btnSmall}
          >
            Descargar plantilla
          </button>

          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={modo === 'sumar'} onChange={() => setModo('sumar')} />
            Sumar al stock actual
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" checked={modo === 'reemplazar'} onChange={() => setModo('reemplazar')} />
            Reemplazar por el valor del archivo
          </label>
        </div>

        {previa && (
          <div className="mt-4">
            <div className={tableWrap}>
              <table className="w-full text-sm">
                <thead className={tableHead}>
                  <tr>
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2 text-right">Mínimo</th>
                    <th className="px-3 py-2">Qué va a pasar</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.map((r, i) => (
                    <tr key={i} className="border-b border-[var(--edr-border)] last:border-0">
                      <td className="px-3 py-2">
                        <input
                          className={field}
                          value={r.nombre}
                          onChange={(e) =>
                            setPrevia((p) =>
                              p!.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x))
                            )
                          }
                        />
                      </td>
                      <td className="edr-mono px-3 py-2 text-xs">{r.existente?.codigo || r.codigo || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          className={`${field} w-20 text-right`}
                          type="number"
                          value={r.cantidad}
                          onChange={(e) =>
                            setPrevia((p) =>
                              p!.map((x, j) =>
                                j === i ? { ...x, cantidad: Math.max(0, Number(e.target.value) || 0) } : x
                              )
                            )
                          }
                        />
                      </td>
                      <td className="edr-mono px-3 py-2 text-right">{r.minimo ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.existente ? (
                          modo === 'reemplazar' ? (
                            <>
                              Queda en <strong>{r.cantidad}</strong> (hoy tiene {r.existente.stock})
                            </>
                          ) : (
                            <>
                              Suma <strong>+{r.cantidad}</strong> (hoy tiene {r.existente.stock})
                            </>
                          )
                        ) : (
                          <span className="text-[var(--edr-yellow)]">Producto nuevo</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={confirmarImport} disabled={importando} className={btnPrimary}>
                {importando ? 'Importando…' : 'Confirmar importación'}
              </button>
              <button onClick={cancelarImport} className={btnGhost}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Stock ------------------------------------------------------- */}
      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold">Stock a la fecha</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--edr-muted)]">
              {stock.length} producto(s) · {totalUnidades} unidades
              {bajos > 0 && <span className="ml-1 text-[var(--edr-yellow)]">· {bajos} para reponer</span>}
            </span>
            <button
              onClick={() =>
                downloadCSV(
                  `stock-${cliente.name}.csv`,
                  ['Producto', 'Código', 'Stock', 'Mínimo'],
                  stock.map((p) => [p.nombre, p.codigo, p.stock, p.minimo])
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
                <th className="px-3 py-2">Producto</th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Movimiento rápido</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                    Cargando…
                  </td>
                </tr>
              )}

              {!loading && stock.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                    Todavía no hay productos de {cliente.name}. Cargá el primero arriba.
                  </td>
                </tr>
              )}

              {stock.map((p) => {
                const bajo = p.stock <= p.minimo;
                return (
                  <tr
                    key={p.product_id}
                    className="border-b border-[var(--edr-border)] last:border-0 hover:bg-[var(--edr-surface-2)]"
                  >
                    <td className="px-3 py-2 font-semibold">{p.nombre}</td>
                    <td className="edr-mono px-3 py-2 text-xs">{p.codigo}</td>
                    <td className={`edr-mono px-3 py-2 text-right font-bold ${bajo ? 'text-red-300' : ''}`}>
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
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <input
                          className={`${field} w-20`}
                          type="number"
                          min={1}
                          placeholder="0"
                          value={rapido[p.product_id] ?? ''}
                          onChange={(e) => setRapido({ ...rapido, [p.product_id]: e.target.value })}
                        />
                        <button
                          onClick={() => mover(p, 'ingreso')}
                          disabled={trabajando === p.product_id}
                          className={btnSmall}
                          title="Entró mercadería"
                        >
                          Entró
                        </button>
                        <button
                          onClick={() => mover(p, 'egreso')}
                          disabled={trabajando === p.product_id}
                          className={btnSmall}
                          title="Salida manual"
                        >
                          Salió
                        </button>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => setEditando(p)} className={btnSmall}>
                        Editar
                      </button>
                      <button
                        onClick={() => borrar(p)}
                        className="ml-1 rounded border border-red-400 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-950"
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal de edición -------------------------------------------- */}
      {editando && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-16 w-full max-w-md rounded-lg bg-[var(--edr-surface)] shadow-xl">
            <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
              <h2 className="text-lg font-bold">Editar producto</h2>
              <button
                onClick={() => setEditando(null)}
                className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 px-5 py-5">
              <div>
                <label className={labelCls}>Nombre</label>
                <input
                  className={field}
                  value={editando.nombre}
                  onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>Alerta de stock bajo</label>
                <input
                  className={field}
                  type="number"
                  value={editando.minimo}
                  onChange={(e) => setEditando({ ...editando, minimo: Number(e.target.value) || 0 })}
                />
              </div>
              <p className="text-xs text-[var(--edr-muted)]">
                El código <span className="edr-mono">{editando.codigo}</span> no se cambia: es el que quedó
                impreso en la mercadería.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--edr-border)] px-5 py-4">
              <button onClick={() => setEditando(null)} className={btnGhost}>
                Cancelar
              </button>
              <button onClick={guardarEdicion} className={btnPrimary}>
                Guardar cambios
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
