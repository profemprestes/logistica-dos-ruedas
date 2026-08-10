'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '@/components/Logo';
import { downloadCSV, fetchClients, fetchMovements, fetchStock } from '@/lib/stock/db';
import type { MovementRow, StockClient, StockRow } from '@/lib/stock/types';
import { fechaCorta } from '@/lib/stock/types';
import { supabase } from '@/lib/supabaseClient';
import { btnSmall, tableHead, tableWrap } from '@/components/stock/ui';

/**
 * Lo que ve el comercio: su stock y sus entradas y salidas. Nada más.
 *
 * No hace falta filtrar por cliente acá: las políticas del paso 13 sólo le
 * dejan leer las filas cuya ficha tiene su `profile_id`. Si alguien manipulara
 * la app desde el navegador, la base sigue sin devolverle nada ajeno.
 */

type Tab = 'stock' | 'movimientos';

/**
 * Consulta suelta, sin estado adentro: devuelve a dónde hay que ir o los datos
 * ya listos, y la pantalla se limita a aplicarlos.
 */
type Carga =
  | { destino: '/login' | '/admin/stock' }
  | { cliente: StockClient | null; stock: StockRow[]; movimientos: MovementRow[] };

async function cargar(): Promise<Carga> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { destino: '/login' };

  // El admin ve TODAS las fichas: si cayó acá, su pantalla es la del panel.
  const { data: perfil } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.session.user.id)
    .single();
  if (perfil?.role === 'admin') return { destino: '/admin/stock' };

  const fichas = await fetchClients();
  const cliente = fichas[0] ?? null;
  if (!cliente) return { cliente: null, stock: [], movimientos: [] };

  const [stock, movimientos] = await Promise.all([
    fetchStock(cliente.id),
    fetchMovements(cliente.id),
  ]);
  return { cliente, stock, movimientos };
}

export default function MiStockPage() {
  const router = useRouter();
  const [cliente, setCliente] = useState<StockClient | null>(null);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovementRow[]>([]);
  const [tab, setTab] = useState<Tab>('stock');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const aplicar = useCallback(
    (r: Carga) => {
      if ('destino' in r) {
        router.replace(r.destino);
        return;
      }
      setCliente(r.cliente);
      setStock(r.stock);
      setMovimientos(r.movimientos);
      setLoading(false);
    },
    [router]
  );

  const fallo = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : 'No se pudo cargar tu stock.');
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    cargar()
      .then((r) => !cancelled && aplicar(r))
      .catch((e) => !cancelled && fallo(e));
    return () => {
      cancelled = true;
    };
  }, [aplicar, fallo]);

  /** Refresco a mano, con el botón de la cabecera. */
  const recargar = () => {
    setLoading(true);
    cargar().then(aplicar).catch(fallo);
  };

  const unidades = stock.reduce((s, p) => s + p.stock, 0);
  const reponer = stock.filter((p) => p.stock <= p.minimo).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-[var(--edr-border)] bg-[var(--edr-surface)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div>
              <h1 className="text-xl font-black tracking-tight text-[var(--edr-yellow)]">
                {cliente?.nombre ?? 'Mi stock'}
              </h1>
              <p className="text-xs text-[var(--edr-muted)]">
                Tu mercadería en el depósito de Envíos DosRuedas
              </p>
            </div>
          </div>

          <button
            onClick={recargar}
            title="Actualizar"
            aria-label="Actualizar"
            className="ml-auto rounded border border-[var(--edr-border)] px-3 py-2 text-lg leading-none hover:bg-[var(--edr-surface-2)]"
          >
            ⟳
          </button>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace('/login');
            }}
            className="rounded border border-[var(--edr-border)] px-3 py-2 text-sm hover:bg-[var(--edr-surface-2)]"
          >
            Salir
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-6">
        {error && (
          <div className="mb-4 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {!loading && !cliente && (
          <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-10 text-center text-sm text-[var(--edr-muted)]">
            Tu usuario todavía no está vinculado a una ficha de depósito. Avisanos y lo enganchamos.
          </div>
        )}

        {cliente && (
          <>
            {/* Resumen ---------------------------------------------- */}
            <div className="mb-5 grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">Productos</div>
                <div className="edr-mono text-2xl font-black">{stock.length}</div>
              </div>
              <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">Unidades</div>
                <div className="edr-mono text-2xl font-black">{unidades}</div>
              </div>
              <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">Para reponer</div>
                <div className={`edr-mono text-2xl font-black ${reponer ? 'text-red-300' : ''}`}>
                  {reponer}
                </div>
              </div>
            </div>

            <nav className="mb-5 flex flex-wrap gap-1 border-b border-[var(--edr-border)]">
              {([
                { id: 'stock' as const, label: 'Mi stock' },
                { id: 'movimientos' as const, label: 'Entradas y salidas' },
              ]).map((t) => (
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
                      {loading && (
                        <tr>
                          <td colSpan={4} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                            Cargando…
                          </td>
                        </tr>
                      )}

                      {!loading && stock.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                            Todavía no hay productos tuyos en depósito.
                          </td>
                        </tr>
                      )}

                      {stock.map((p) => {
                        const bajo = p.stock <= p.minimo;
                        return (
                          <tr key={p.product_id} className="border-b border-[var(--edr-border)] last:border-0">
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
                        stock.map((p) => [p.nombre, p.codigo, p.stock])
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
                        <td className="edr-mono px-3 py-2 whitespace-nowrap">{fechaCorta(m.fecha)}</td>
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
          </>
        )}
      </main>
    </div>
  );
}
