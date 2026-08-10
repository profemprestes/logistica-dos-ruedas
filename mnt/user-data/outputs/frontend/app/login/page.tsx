'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import AddShipmentModal from '@/components/AddShipmentModal';
import ShippingLabel from '@/components/ShippingLabel';
import PrintPortal from '@/components/PrintPortal';
import {
  money,
  STATUS_CLASS,
  STATUS_LABEL,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/format';

interface Driver {
  id: string;
  full_name: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | ShipmentStatus>('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [toPrint, setToPrint] = useState<Shipment | null>(null);
  const [error, setError] = useState('');

  // --- sesión ------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login');
      else setReady(true);
    });
  }, [router]);

  // --- datos -------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: dbError } = await supabase
      .from('shipments')
      .select('*, driver:assigned_driver(full_name)')
      .order('id', { ascending: false })
      .limit(300);

    if (dbError) setError(dbError.message);
    else setShipments((data ?? []) as Shipment[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!ready) return;
    load();
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'repartidor')
      .eq('active', true)
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [ready, load]);

  // --- acciones ----------------------------------------------------------
  async function remove(s: Shipment) {
    if (!confirm(`¿Eliminar el envío ${s.tracking_code}? No se puede deshacer.`)) return;
    const { error: dbError } = await supabase.from('shipments').delete().eq('id', s.id);
    if (dbError) setError(dbError.message);
    else load();
  }

  async function assignDriver(s: Shipment, driverId: string) {
    const { error: dbError } = await supabase
      .from('shipments')
      .update({
        assigned_driver: driverId || null,
        assigned_at: driverId ? new Date().toISOString() : null,
        status: driverId && s.status === 'creado' ? 'pendiente_retiro' : s.status,
      })
      .eq('id', s.id);
    if (dbError) setError(dbError.message);
    else load();
  }

  async function changeStatus(s: Shipment, status: ShipmentStatus) {
    const { error: dbError } = await supabase.from('shipments').update({ status }).eq('id', s.id);
    if (dbError) setError(dbError.message);
    else load();
  }

  function print(s: Shipment) {
    setToPrint(s);
    // Espera a que la etiqueta se dibuje antes de abrir el diálogo de impresión
    setTimeout(() => window.print(), 250);
  }

  // --- filtros -----------------------------------------------------------
  const visible = shipments.filter((s) => {
    const okStatus = statusFilter === 'todos' || s.status === statusFilter;
    const q = search.trim().toLowerCase();
    const okSearch =
      !q ||
      s.tracking_code?.toLowerCase().includes(q) ||
      s.recipient_name.toLowerCase().includes(q) ||
      s.address_street.toLowerCase().includes(q) ||
      (s.client_name_raw ?? '').toLowerCase().includes(q);
    return okStatus && okSearch;
  });

  const totalToCollect = visible.reduce((acc, s) => acc + Number(s.amount_to_collect ?? 0), 0);

  if (!ready) return <div className="p-8 text-sm text-neutral-500">Cargando…</div>;

  return (
    <div className="min-h-screen">
      {/* Barra superior */}
      <header className="border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-xl font-black tracking-tight">Envíos DosRuedas</h1>
            <p className="text-xs text-neutral-500">Panel de administración</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              className="rounded bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              + Nuevo envío
            </button>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace('/login');
              }}
              className="rounded border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* Filtros */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, destinatario, dirección o comercio"
            className="w-full max-w-sm rounded border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'todos' | ShipmentStatus)}
            className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm"
          >
            <option value="todos">Todos los estados</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <div className="ml-auto rounded border-2 border-neutral-900 bg-[var(--edr-hiviz)] px-3 py-1.5 text-sm font-bold">
            A cobrar: <span className="edr-mono">{money(totalToCollect)}</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Tabla */}
        <div className="overflow-x-auto rounded border border-neutral-300 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-300 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Destinatario</th>
                <th className="px-3 py-2">Dirección</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Repartidor</th>
                <th className="px-3 py-2 text-right">A cobrar</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-500">Cargando envíos…</td></tr>
              )}

              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-neutral-500">
                    No hay envíos que coincidan. Cargá el primero con “+ Nuevo envío”.
                  </td>
                </tr>
              )}

              {visible.map((s) => (
                <tr key={s.id} className="border-b border-neutral-200 last:border-0 hover:bg-neutral-50">
                  <td className="edr-mono whitespace-nowrap px-3 py-2 text-xs font-semibold">
                    {s.tracking_code}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{s.recipient_name}</div>
                    <div className="text-xs text-neutral-500">{s.client_name_raw}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{s.address_street}{s.address_extra ? ` — ${s.address_extra}` : ''}</div>
                    <div className="text-xs text-neutral-500">
                      {s.city}{s.delivery_window ? ` · ${s.delivery_window}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.status}
                      onChange={(e) => changeStatus(s, e.target.value as ShipmentStatus)}
                      className={`rounded px-2 py-1 text-xs font-semibold ring-1 ${STATUS_CLASS[s.status]}`}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.assigned_driver ?? ''}
                      onChange={(e) => assignDriver(s, e.target.value)}
                      className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="">Libre (por escaneo)</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>{d.full_name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {Number(s.amount_to_collect) > 0 ? (
                      <span className="edr-mono inline-block bg-[var(--edr-hiviz)] px-2 py-1 font-bold">
                        {money(s.amount_to_collect)}
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      onClick={() => { setEditing(s); setModalOpen(true); }}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs font-semibold hover:bg-neutral-100"
                    >
                      Ver / editar
                    </button>
                    <button
                      onClick={() => print(s)}
                      className="ml-1 rounded border border-neutral-300 px-2 py-1 text-xs font-semibold hover:bg-neutral-100"
                    >
                      Imprimir etiqueta
                    </button>
                    <button
                      onClick={() => remove(s)}
                      className="ml-1 rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <AddShipmentModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />

      {/* La etiqueta vive fuera del flujo visual: solo aparece al imprimir */}
      {toPrint && (
        <PrintPortal>
          <ShippingLabel shipment={toPrint} />
        </PrintPortal>
      )}
    </div>
  );
}
