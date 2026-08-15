'use client';

import { useCallback, useEffect, useState } from 'react';
import ClientesTab from '@/components/stock/ClientesTab';
import DescargaTab from '@/components/stock/DescargaTab';
import MovimientosTab from '@/components/stock/MovimientosTab';
import StockTab from '@/components/stock/StockTab';
import { fetchClients, fetchMovements, fetchStock } from '@/lib/stock/db';
import type { MovementRow, StockClient, StockRow } from '@/lib/stock/types';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { field } from '@/components/stock/ui';

/**
 * Control de stock del depósito. Reemplaza al sistema que corría aparte en
 * `stock-edr` con su propio server y su `datos.json`.
 *
 * Todo lo que se ve acá es de UN cliente por vez: el que está elegido arriba.
 * Es a propósito — descontar del cliente equivocado es el error más caro que
 * se puede cometer en esta pantalla.
 */

type Tab = 'stock' | 'descarga' | 'movimientos' | 'clientes';

const TABS: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'Stock' },
  { id: 'descarga', label: 'Descargar entregas' },
  { id: 'movimientos', label: 'Movimientos' },
  { id: 'clientes', label: 'Clientes' },
];

/* Consultas sueltas, sin estado adentro: se pueden disparar desde un efecto
   sin que React arranque una cascada de renders. */

interface ClientsPayload {
  lista: StockClient[];
  /** Cuántos productos tiene cada cliente, para la tabla de Clientes. */
  cuenta: Record<string, number>;
}

async function fetchClientsWithCounts(): Promise<ClientsPayload> {
  const [lista, { data }] = await Promise.all([
    fetchClients(),
    supabase.from('stock_products').select('client_id'),
  ]);

  const cuenta: Record<string, number> = {};
  for (const p of data ?? []) cuenta[p.client_id] = (cuenta[p.client_id] ?? 0) + 1;

  return { lista, cuenta };
}

type ClientDataPayload = [StockRow[], MovementRow[]];

function fetchClientData(id: string): Promise<ClientDataPayload> {
  return Promise.all([fetchStock(id), fetchMovements(id)]);
}

export default function AdminStockPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [tab, setTab] = useState<Tab>('stock');

  const [clientes, setClientes] = useState<StockClient[]>([]);
  const [clienteId, setClienteId] = useState('');
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovementRow[]>([]);
  const [conteos, setConteos] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /** Los resultados de `fetchAll` ya aplicados al estado de la pantalla. */
  const applyClients = useCallback(({ lista, cuenta }: ClientsPayload) => {
    setClientes(lista);
    setConteos(cuenta);
    // Si todavía no hay ninguno elegido, arranco por el primero activo.
    setClienteId((actual) => {
      if (actual && lista.some((c) => c.id === actual)) return actual;
      return lista.find((c) => c.activo)?.id ?? lista[0]?.id ?? '';
    });
    if (!lista.length) setLoading(false);
  }, []);

  const applyClientData = useCallback(([s, m]: ClientDataPayload) => {
    setStock(s);
    setMovimientos(m);
    setLoading(false);
  }, []);

  const fallo = useCallback((e: unknown, msg: string) => {
    setError(e instanceof Error ? e.message : msg);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchClientsWithCounts()
      .then((p) => !cancelled && applyClients(p))
      .catch((e) => !cancelled && fallo(e, 'No se pudieron cargar los clientes.'));
    return () => {
      cancelled = true;
    };
  }, [ready, applyClients, fallo]);

  useEffect(() => {
    if (!ready || !clienteId) return;
    let cancelled = false;
    fetchClientData(clienteId)
      .then((p) => !cancelled && applyClientData(p))
      .catch((e) => !cancelled && fallo(e, 'No se pudo cargar el stock.'));
    return () => {
      cancelled = true;
    };
  }, [ready, clienteId, applyClientData, fallo]);

  /** Refresco a mano, después de que una pestaña toca algo. */
  const reload = useCallback(async () => {
    try {
      const [clientes, datos] = await Promise.all([
        fetchClientsWithCounts(),
        clienteId ? fetchClientData(clienteId) : Promise.resolve(null),
      ]);
      applyClients(clientes);
      if (datos) applyClientData(datos);
    } catch (e) {
      fallo(e, 'No se pudo refrescar la pantalla.');
    }
  }, [clienteId, applyClients, applyClientData, fallo]);

  /** Los avisos se van solos: si no, quedan colgados de una acción vieja. */
  const aviso = useCallback((msg: string) => {
    setNotice(msg);
    if (msg) setTimeout(() => setNotice(''), 6000);
  }, []);

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  const cliente = clientes.find((c) => c.id === clienteId) ?? null;

  return (
    <div className="min-h-full">

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Cliente activo ------------------------------------------- */}
        <section className="mb-5 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-4">
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
            Estás viendo el cliente
          </label>
          <div className="flex flex-wrap items-center gap-4">
            <select
              className={`${field} max-w-xs`}
              value={clienteId}
              onChange={(e) => {
                setLoading(true);
                setClienteId(e.target.value);
              }}
            >
              {clientes.length === 0 && <option value="">— sin clientes —</option>}
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                  {c.activo ? '' : ' (inactivo)'}
                </option>
              ))}
            </select>

            {cliente && (
              <span className="text-xs text-[var(--edr-muted)]">
                Prefijo <span className="edr-mono">{cliente.prefijo}</span> · {stock.length} producto(s) ·{' '}
                {stock.reduce((s, p) => s + p.stock, 0)} unidades en depósito
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-[var(--edr-muted)]">
            Todo lo que ves en Stock, Descargar entregas y Movimientos es únicamente de este cliente.
          </p>
        </section>

        {/* Pestañas -------------------------------------------------- */}
        <nav className="mb-5 flex flex-wrap gap-1 border-b border-[var(--edr-border)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px rounded-t px-4 py-2 text-sm font-semibold ${
                tab === t.id
                  ? 'border-b-2 border-[var(--edr-yellow)] text-[var(--edr-acento)]'
                  : 'text-[var(--edr-muted)] hover:text-[var(--edr-acento)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {notice && (
          <div className="mb-4 rounded border border-emerald-400 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* Contenido ------------------------------------------------- */}
        {tab === 'clientes' ? (
          <ClientesTab
            clientes={clientes}
            conteos={conteos}
            onReload={reload}
            onError={setError}
            onNotice={aviso}
          />
        ) : !cliente ? (
          <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-10 text-center text-sm text-[var(--edr-muted)]">
            Todavía no hay ningún cliente cargado. Creá el primero en la pestaña Clientes.
          </div>
        ) : tab === 'stock' ? (
          <StockTab
            cliente={cliente}
            stock={stock}
            loading={loading}
            onReload={reload}
            onError={setError}
            onNotice={aviso}
          />
        ) : tab === 'descarga' ? (
          <DescargaTab
            cliente={cliente}
            stock={stock}
            onReload={reload}
            onError={setError}
            onNotice={aviso}
          />
        ) : (
          <MovimientosTab
            cliente={cliente}
            stock={stock}
            movimientos={movimientos}
            loading={loading}
            onReload={reload}
            onError={setError}
          />
        )}
      </main>
    </div>
  );
}
