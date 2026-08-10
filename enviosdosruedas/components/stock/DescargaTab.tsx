'use client';

import { useMemo, useState } from 'react';
import { addMovements, deleteMovements } from '@/lib/stock/db';
import { analizarTexto, type ParsedItem, type ParsedWarning } from '@/lib/stock/parse';
import type { StockClient, StockRow } from '@/lib/stock/types';
import { hoyISO } from '@/lib/stock/types';
import { btnGhost, btnPrimary, btnSmall, card, field, labelCls, tableHead, tableWrap } from './ui';

interface Props {
  cliente: StockClient;
  stock: StockRow[];
  onReload: () => Promise<void>;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}

const EJEMPLO = `23/7
1) Carasa 4205. Cobrar $51900 (Óxido nítrico x2)
2) Meyrelles 3385. Cobrar $36900 (Nad x1)
3) Mugaburu 7681. Cobrar $55940 (Óxido nitrico x2)
Efectivo cobrado $196.640`;

/** Cómo se ve cada estado del match en la tabla de previa. */
const ESTADOS: Record<ParsedItem['estado'], { texto: string; clase: string }> = {
  exacto: { texto: 'Coincide', clase: 'bg-emerald-950 text-emerald-200 ring-emerald-400' },
  aproximado: { texto: 'Aproximado', clase: 'bg-amber-950 text-amber-200 ring-amber-400' },
  ambiguo: { texto: 'Elegí cuál', clase: 'bg-amber-950 text-amber-200 ring-amber-400' },
  sin_match: { texto: 'No lo encontré', clase: 'bg-red-950 text-red-200 ring-red-400' },
  sin_texto: { texto: 'Sin producto', clase: 'bg-red-950 text-red-200 ring-red-400' },
};

export default function DescargaTab({ cliente, stock, onReload, onError, onNotice }: Props) {
  const [texto, setTexto] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [items, setItems] = useState<ParsedItem[] | null>(null);
  const [avisos, setAvisos] = useState<ParsedWarning[]>([]);
  const [totalDeclarado, setTotalDeclarado] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  /** Ids de la última descarga confirmada, para poder deshacerla. */
  const [ultima, setUltima] = useState<string[]>([]);

  const listos = useMemo(() => (items ?? []).filter((i) => i.productId && i.cantidad > 0), [items]);
  const unidades = useMemo(() => listos.reduce((s, i) => s + i.cantidad, 0), [listos]);
  const cobrado = useMemo(
    () => (items ?? []).reduce((s, i) => s + (i.cobrar ?? 0), 0),
    [items]
  );

  function revisar() {
    onError('');
    if (!texto.trim()) return onError('Pegá el mensaje del día antes de revisar.');
    const r = analizarTexto(texto, stock, fecha);
    setItems(r.items);
    setAvisos(r.avisos);
    setTotalDeclarado(r.totalDeclarado);
    if (!r.items.length) onError('No encontré ninguna línea de entrega en ese texto.');
  }

  function limpiar() {
    setTexto('');
    setItems(null);
    setAvisos([]);
    setTotalDeclarado(null);
    onError('');
  }

  async function confirmar() {
    if (!listos.length) return onError('No hay líneas con producto asignado para descontar.');

    const sinAsignar = (items ?? []).length - listos.length;
    if (
      sinAsignar > 0 &&
      !confirm(
        `Hay ${sinAsignar} línea(s) sin producto asignado: esas NO se descuentan. ¿Confirmás las ${listos.length} que sí están?`
      )
    )
      return;

    setConfirmando(true);
    onError('');
    try {
      const ids = await addMovements(
        listos.map((i) => ({
          clientId: cliente.id,
          productId: i.productId!,
          tipo: 'egreso' as const,
          cantidad: i.cantidad,
          fecha: i.fecha,
          nota: i.direccion ? `Entrega: ${i.direccion}` : 'Entrega',
        }))
      );
      setUltima(ids);
      onNotice(`Descontadas ${unidades} unidad(es) en ${listos.length} línea(s).`);
      setItems(null);
      setAvisos([]);
      setTexto('');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo descontar.');
    }
    setConfirmando(false);
  }

  async function deshacer() {
    if (!confirm('¿Deshacer la última descarga? Las unidades vuelven al stock.')) return;
    onError('');
    try {
      await deleteMovements(ultima);
      setUltima([]);
      onNotice('Descarga deshecha: el stock volvió como estaba.');
      await onReload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'No se pudo deshacer.');
    }
  }

  function cambiarProducto(idx: number, productId: string) {
    setItems((prev) =>
      prev!.map((it, i) =>
        i === idx ? { ...it, productId: productId || null, estado: productId ? 'exacto' : 'sin_match' } : it
      )
    );
  }

  return (
    <div className="space-y-6">
      {ultima.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-sm">
          <span>Última descarga: {ultima.length} línea(s) descontadas.</span>
          <button onClick={deshacer} className={btnSmall}>
            Deshacer
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pegar ---------------------------------------------------- */}
        <section className={card}>
          <h2 className="mb-1 text-base font-bold">Pegar entregas del día</h2>
          <p className="mb-4 text-xs text-[var(--edr-muted)]">
            Pegá el mensaje tal cual lo escribís. Leo la fecha suelta de arriba, la dirección, el monto de
            &ldquo;Cobrar&rdquo; y el producto entre paréntesis.
          </p>

          <div className="mb-3 max-w-[200px]">
            <label className={labelCls}>Fecha por defecto</label>
            <input className={field} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>

          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            spellCheck={false}
            rows={12}
            placeholder={EJEMPLO}
            className={`${field} font-mono text-xs leading-relaxed`}
          />

          <div className="mt-3 flex gap-2">
            <button onClick={revisar} className={btnPrimary}>
              Revisar antes de descontar
            </button>
            <button onClick={limpiar} className={btnGhost}>
              Limpiar
            </button>
          </div>
        </section>

        {/* Previa --------------------------------------------------- */}
        <section className={card}>
          <h2 className="mb-1 text-base font-bold">Previsualización</h2>
          <p className="mb-4 text-xs text-[var(--edr-muted)]">
            No se descuenta nada hasta que confirmes. Revisá que cada línea apunte al producto correcto.
          </p>

          {avisos.length > 0 && (
            <ul className="mb-3 space-y-1 rounded border border-amber-400 bg-amber-950 px-3 py-2 text-xs text-amber-100">
              {avisos.map((a, i) => (
                <li key={i}>
                  <strong>Línea {a.linea}:</strong> {a.motivo}{' '}
                  <span className="opacity-70">({a.texto})</span>
                </li>
              ))}
            </ul>
          )}

          <div className={tableWrap}>
            <table className="w-full text-sm">
              <thead className={tableHead}>
                <tr>
                  <th className="px-2 py-2">Dirección</th>
                  <th className="px-2 py-2">Detectado</th>
                  <th className="px-2 py-2">Se descuenta de</th>
                  <th className="px-2 py-2 text-right">Cant.</th>
                </tr>
              </thead>
              <tbody>
                {!items && (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                      Pegá el mensaje y tocá &ldquo;Revisar&rdquo;.
                    </td>
                  </tr>
                )}

                {items?.map((it, i) => {
                  const estado = ESTADOS[it.estado];
                  return (
                    <tr key={i} className="border-b border-[var(--edr-border)] last:border-0 align-top">
                      <td className="px-2 py-2">
                        <div className="font-semibold">{it.direccion || '—'}</div>
                        <div className="text-[10px] text-[var(--edr-muted)]">
                          Línea {it.linea} · {it.fecha}
                          {it.cobrar ? ` · $${it.cobrar.toLocaleString('es-AR')}` : ''}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div>{it.textoProducto}</div>
                        <span
                          className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${estado.clase}`}
                        >
                          {estado.texto}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className={field}
                          value={it.productId ?? ''}
                          onChange={(e) => cambiarProducto(i, e.target.value)}
                        >
                          <option value="">— no descontar —</option>
                          {stock.map((p) => (
                            <option key={p.product_id} value={p.product_id}>
                              {p.nombre} ({p.stock})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          className={`${field} w-16 text-right`}
                          type="number"
                          min={1}
                          value={it.cantidad}
                          onChange={(e) =>
                            setItems((prev) =>
                              prev!.map((x, j) =>
                                j === i ? { ...x, cantidad: Math.max(1, Number(e.target.value) || 1) } : x
                              )
                            )
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {items && items.length > 0 && (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-2 py-2">
                  <div className="text-[10px] uppercase text-[var(--edr-muted)]">Líneas</div>
                  <div className="edr-mono text-lg font-bold">
                    {listos.length}
                    {listos.length !== items.length && (
                      <span className="text-xs text-[var(--edr-muted)]">/{items.length}</span>
                    )}
                  </div>
                </div>
                <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-2 py-2">
                  <div className="text-[10px] uppercase text-[var(--edr-muted)]">Unidades</div>
                  <div className="edr-mono text-lg font-bold">{unidades}</div>
                </div>
                <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-2 py-2">
                  <div className="text-[10px] uppercase text-[var(--edr-muted)]">Cobrado</div>
                  <div className="edr-mono text-lg font-bold">${cobrado.toLocaleString('es-AR')}</div>
                </div>
              </div>

              {totalDeclarado !== null && Math.abs(totalDeclarado - cobrado) > 1 && (
                <p className="mt-2 text-xs text-amber-200">
                  El mensaje declara ${totalDeclarado.toLocaleString('es-AR')} y las líneas suman $
                  {cobrado.toLocaleString('es-AR')}. Revisá antes de confirmar.
                </p>
              )}

              <button onClick={confirmar} disabled={confirmando} className={`${btnPrimary} mt-3 w-full`}>
                {confirmando ? 'Descontando…' : 'Confirmar y descontar del stock'}
              </button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
