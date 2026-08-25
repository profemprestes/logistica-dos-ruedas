'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import MovimientosTab from '@/components/stock/MovimientosTab';
import StockTab from '@/components/stock/StockTab';
import { fetchComerciosConStock, fetchMovements, fetchStock, FALTA_PASO_56 } from '@/lib/stock/db';
import type { ComercioConStock, MovementRow, StockRow } from '@/lib/stock/types';
import { useAdminGuard } from '@/lib/adminGuard';
import { field } from '@/components/stock/ui';

/**
 * Control de stock del depósito.
 *
 * LOS CLIENTES DE ACÁ SON LOS COMERCIOS (paso 56). Antes esta pantalla tenía
 * su propia lista de clientes, aparte de los comercios de verdad: dos listas
 * del mismo mundo. Ahora un comercio guarda stock cuando su ficha tiene la
 * marca "maneja stock en base" — se prende en Comercios, no acá.
 *
 * Todo lo que se ve es de UN comercio por vez: el elegido arriba. Es a
 * propósito — descontar del cliente equivocado es el error más caro que se
 * puede cometer en esta pantalla.
 *
 * LA PESTAÑA "DESCARGAR ENTREGAS" SE FUE. Descontaba pegando el mensaje del
 * día, el mismo texto que ya se pegaba para cargar los envíos. Hoy cada envío
 * lleva su pedido y la base descuenta sola cuando el envío pasa a entregado.
 */

type Tab = 'stock' | 'movimientos';

const TABS: { id: Tab; label: string }[] = [
  { id: 'stock', label: 'Stock' },
  { id: 'movimientos', label: 'Movimientos' },
];

type ClientDataPayload = [StockRow[], MovementRow[]];

function fetchClientData(id: number): Promise<ClientDataPayload> {
  return Promise.all([fetchStock(id), fetchMovements(id)]);
}

export default function AdminStockPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [tab, setTab] = useState<Tab>('stock');

  const [comercios, setComercios] = useState<ComercioConStock[]>([]);
  const [clienteId, setClienteId] = useState(0);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [movimientos, setMovimientos] = useState<MovementRow[]>([]);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /**
   * De qué comercio son los datos que están EN PANTALLA. Mientras no coincida
   * con el elegido, se está cargando: así el efecto no necesita prender un
   * "cargando" a mano (el compilador de React marca ese patrón) y el estado
   * nunca puede quedar mintiendo.
   */
  const [datosDe, setDatosDe] = useState(0);
  const [sinComercios, setSinComercios] = useState(false);

  const applyComercios = useCallback((lista: ComercioConStock[]) => {
    setComercios(lista);
    // Si todavía no hay ninguno elegido, arranco por el primero.
    setClienteId((actual) =>
      actual && lista.some((c) => c.id === actual) ? actual : (lista[0]?.id ?? 0),
    );
  }, []);

  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    fetchComerciosConStock()
      .then((lista) => {
        if (!vivo) return;
        applyComercios(lista);
        setSinComercios(lista.length === 0);
      })
      .catch((e) => {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : 'No se pudieron traer los comercios.');
        setSinComercios(true);
      });

    return () => {
      vivo = false;
    };
  }, [ready, applyComercios]);

  useEffect(() => {
    if (!ready || !clienteId) return;
    let vivo = true;

    fetchClientData(clienteId)
      .then(([s, m]) => {
        if (!vivo) return;
        setStock(s);
        setMovimientos(m);
        setDatosDe(clienteId);
      })
      .catch((e) => {
        if (!vivo) return;
        setError(e instanceof Error ? e.message : 'No se pudo cargar el stock.');
        setDatosDe(clienteId);
      });

    return () => {
      vivo = false;
    };
  }, [ready, clienteId]);

  /** Recarga después de un alta, un movimiento o un borrado. */
  const recargar = useCallback(async () => {
    if (!clienteId) return;
    try {
      const [s, m] = await fetchClientData(clienteId);
      setStock(s);
      setMovimientos(m);
    } catch {
      /* la pantalla se queda con lo que tenía */
    }
  }, [clienteId]);

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  const comercio = comercios.find((c) => c.id === clienteId) ?? null;
  const esFaltaPaso = error === FALTA_PASO_56;
  const loading = clienteId !== 0 && datosDe !== clienteId;

  return (
    <main className="mx-auto max-w-5xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-black sm:text-2xl">Stock del depósito</h2>

        {comercios.length > 0 && (
          <select
            className={`${field} ml-auto w-auto`}
            value={clienteId}
            onChange={(e) => setClienteId(Number(e.target.value))}
          >
            {comercios.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded border border-emerald-400 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </div>
      )}

      {/* Sin comercios marcados no hay nada que administrar: se dice dónde se
          marca, que es la pregunta que el que llegó acá se está haciendo. */}
      {!esFaltaPaso && sinComercios && comercios.length === 0 && !error && (
        <div className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-10 text-center text-sm text-[var(--edr-muted)]">
          Ningún comercio tiene stock en base todavía.
          <br />
          Se marca en{' '}
          <Link href="/admin/comercios" className="font-bold underline underline-offset-2">
            Comercios
          </Link>
          , abriendo la ficha y prendiendo «Maneja stock en base».
        </div>
      )}

      {comercio && (
        <>
          <nav className="mb-5 flex flex-wrap gap-1 border-b border-[var(--edr-border)]">
            {TABS.map((t) => (
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
            <StockTab
              cliente={comercio}
              stock={stock}
              loading={loading}
              onReload={recargar}
              onError={setError}
              onNotice={setNotice}
            />
          ) : (
            <MovimientosTab
              cliente={comercio}
              stock={stock}
              movimientos={movimientos}
              loading={loading}
              onReload={recargar}
              onError={setError}
            />
          )}
        </>
      )}
    </main>
  );
}
