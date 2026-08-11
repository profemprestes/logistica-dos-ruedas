'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import AddShipmentModal from '@/components/AddShipmentModal';
import ShippingLabel from '@/components/ShippingLabel';
import PrintPortal from '@/components/PrintPortal';
import AdminNav from '@/components/AdminNav';
import { notificarRepartidor } from '@/lib/notify';
import ProofOfDeliveryModal from '@/components/ProofOfDeliveryModal';
import ShipmentMobileCard from '@/components/admin/ShipmentMobileCard';
import {
  money,
  shipmentCash,
  STATUS_CLASS,
  STATUS_LABEL,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/format';

interface Driver {
  id: string;
  full_name: string;
}

/** Estados en los que ya existe una prueba de entrega para mirar */
const HAS_PROOF: ShipmentStatus[] = ['entregado', 'pendiente_entrega'];

/** Consultas sueltas, sin estado adentro: se pueden disparar desde un efecto. */
function fetchShipments() {
  return supabase
    .from('shipments')
    .select('*, driver:assigned_driver(full_name)')
    .order('id', { ascending: false })
    .limit(300);
}

function fetchDrivers() {
  return supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'repartidor')
    .eq('active', true);
}

export default function AdminPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | ShipmentStatus>('todos');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Shipment | null>(null);
  const [toPrint, setToPrint] = useState<Shipment | null>(null);
  const [proof, setProof] = useState<Shipment | null>(null);
  const [error, setError] = useState('');

  const applyShipments = useCallback(
    ({ data, error: dbError }: Awaited<ReturnType<typeof fetchShipments>>) => {
      if (dbError) setError(dbError.message);
      else setShipments((data ?? []) as Shipment[]);
      setLoading(false);
    },
    [],
  );

  /** Refresco a mano, después de guardar, borrar o cambiar un envío. */
  const load = useCallback(() => {
    setLoading(true);
    return fetchShipments().then(applyShipments);
  }, [applyShipments]);

  // Primera carga: el spinner ya arranca prendido, sólo hay que pedir los datos.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    fetchShipments().then((res) => {
      if (!cancelled) applyShipments(res);
    });
    fetchDrivers().then(({ data }) => {
      if (!cancelled) setDrivers((data ?? []) as Driver[]);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, applyShipments]);

  async function remove(s: Shipment) {
    // Borrar un envío que ya está en la calle deja al repartidor con una entrega
    // imposible de cerrar: cuando su celular la mande, el servidor contesta
    // ENVIO_NO_ENCONTRADO y el comprobante (foto, firma, GPS) se pierde.
    const enLaCalle = s.assigned_driver && s.status !== 'creado' && s.status !== 'cancelado';

    const aviso = enLaCalle
      ? `OJO: ${s.tracking_code} ya lo tiene ${s.driver?.full_name ?? 'un repartidor'} ` +
        `(${STATUS_LABEL[s.status]}).\n\n` +
        'Si lo borrás y él ya lo cerró en el celular, esa entrega se va a rechazar y ' +
        'pierde la foto y el GPS.\n\nConviene marcarlo como "Cancelado" en vez de borrarlo.\n\n' +
        '¿Borrar igual?'
      : `¿Eliminar el envío ${s.tracking_code}? No se puede deshacer.`;

    if (!confirm(aviso)) return;
    const { error: dbError } = await supabase.from('shipments').delete().eq('id', s.id);
    if (dbError) setError(dbError.message);
    else void load();
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

    if (dbError) {
      setError(dbError.message);
      return;
    }

    // Asignado a mano: el repartidor no lo escaneó, así que si no le avisamos
    // no se entera hasta que abra la app por casualidad.
    if (driverId) {
      void notificarRepartidor({
        driverId,
        title: 'Te asignaron un envío',
        body: `${s.address_street}${s.city ? `, ${s.city}` : ''} · ${s.tracking_code}`,
        url: '/driver/dashboard',
        tag: `envio-${s.id}`,
      });
    }

    void load();
  }

  async function changeStatus(s: Shipment, status: ShipmentStatus) {
    const { error: dbError } = await supabase.from('shipments').update({ status }).eq('id', s.id);
    if (dbError) setError(dbError.message);
    else void load();
  }

  function print(s: Shipment) {
    setToPrint(s);
    setTimeout(() => window.print(), 250);
  }

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

  // Suma las dos cobranzas: la de la puerta y la que se le cobra al comercio
  // al retirar. Antes sólo contaba la primera y el total quedaba corto.
  const totales = visible.reduce(
    (acc, s) => {
      const cash = shipmentCash(s);
      return { puerta: acc.puerta + cash.atDelivery, retiro: acc.retiro + cash.atPickup };
    },
    { puerta: 0, retiro: 0 },
  );

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  return (
    <div className="min-h-screen">
      <AdminNav />

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
          {/* En el teléfono el botón va ancho completo y primero: cargar un
              envío desde la calle es la razón principal para entrar acá. */}
          <button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="w-full rounded bg-[var(--edr-yellow)] px-4 py-3 text-base font-black text-black hover:brightness-95 sm:w-auto sm:py-2 sm:text-sm"
          >
            + Nuevo envío
          </button>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, destinatario, dirección o comercio"
            className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)] sm:max-w-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'todos' | ShipmentStatus)}
            className="flex-1 rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm sm:flex-none"
          >
            <option value="todos">Todos los estados</option>
            {Object.entries(STATUS_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>

          <div className="ml-auto rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] text-black px-3 py-1.5 text-sm font-bold">
            A cobrar: <span className="edr-mono">{money(totales.puerta)}</span>
            {totales.retiro > 0 && (
              <span className="ml-2 rounded bg-orange-500 px-2 py-0.5 text-white">
                al retirar <span className="edr-mono">{money(totales.retiro)}</span>
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Teléfono: una tarjeta por envío. La tabla de abajo tiene siete
            columnas y en un celular obliga a arrastrar de costado para llegar
            a los botones, que es justo lo que se necesita desde la calle. */}
        <div className="space-y-2 lg:hidden">
          {loading && (
            <p className="py-8 text-center text-sm text-[var(--edr-muted)]">Cargando envíos…</p>
          )}
          {!loading && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-[var(--edr-muted)]">
              No hay envíos que coincidan. Cargá el primero con “+ Nuevo envío”.
            </p>
          )}
          {visible.map((s) => (
            <ShipmentMobileCard
              key={s.id}
              shipment={s}
              drivers={drivers}
              hasProof={HAS_PROOF.includes(s.status)}
              onProof={setProof}
              onEdit={(x) => {
                setEditing(x);
                setModalOpen(true);
              }}
              onPrint={print}
              onDelete={remove}
              onStatus={changeStatus}
              onAssign={assignDriver}
            />
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] lg:block">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--edr-border)] bg-[var(--edr-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--edr-muted)]">
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
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                    Cargando envíos…
                  </td>
                </tr>
              )}

              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                    No hay envíos que coincidan. Cargá el primero con “+ Nuevo envío”.
                  </td>
                </tr>
              )}

              {visible.map((s) => (
                <tr key={s.id} className="border-b border-[var(--edr-border)] last:border-0 hover:bg-[var(--edr-surface-2)]">
                  <td className="edr-mono whitespace-nowrap px-3 py-2 text-xs font-semibold">
                    {s.tracking_code}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{s.recipient_name}</div>
                    <div className="text-xs text-[var(--edr-muted)]">{s.client_name_raw}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>
                      {s.address_street}
                      {s.address_extra ? ` — ${s.address_extra}` : ''}
                    </div>
                    <div className="text-xs text-[var(--edr-muted)]">
                      {s.city}
                      {s.delivery_window ? ` · ${s.delivery_window}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.status}
                      onChange={(e) => changeStatus(s, e.target.value as ShipmentStatus)}
                      className={`rounded px-2 py-1 text-xs font-semibold ring-1 ${STATUS_CLASS[s.status]}`}
                    >
                      {Object.entries(STATUS_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.assigned_driver ?? ''}
                      onChange={(e) => assignDriver(s, e.target.value)}
                      className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2 py-1 text-xs"
                    >
                      <option value="">Libre (por escaneo)</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CashCell shipment={s} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {HAS_PROOF.includes(s.status) && (
                      <button
                        onClick={() => setProof(s)}
                        className="rounded border-2 border-[var(--edr-yellow)] px-2 py-1 text-xs font-bold hover:bg-[var(--edr-surface-2)]"
                      >
                        Ver prueba
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditing(s);
                        setModalOpen(true);
                      }}
                      className="ml-1 rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                    >
                      Ver / editar
                    </button>
                    <button
                      onClick={() => print(s)}
                      className="ml-1 rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                    >
                      Imprimir
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

      <ProofOfDeliveryModal shipment={proof} onClose={() => setProof(null)} />

      {toPrint && (
        <PrintPortal>
          <ShippingLabel shipment={toPrint} />
        </PrintPortal>
      )}
    </div>
  );
}

/**
 * Plata del envío, separada por MOMENTO de cobro:
 *  - amarillo: se cobra en la puerta, al entregar
 *  - naranja:  se le cobra al comercio al retirar
 * Son dos momentos distintos y confundirlos hace que se cobre dos veces.
 */
function CashCell({ shipment }: { shipment: Shipment }) {
  const cash = shipmentCash(shipment);
  if (cash.total === 0) return <span className="text-xs text-[var(--edr-muted)]">—</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      {cash.atDelivery > 0 && (
        <span className="edr-mono inline-block bg-[var(--edr-hiviz)] px-2 py-1 font-bold text-black">
          {money(cash.atDelivery)}
        </span>
      )}
      {cash.atPickup > 0 && (
        <span className="edr-mono inline-block bg-orange-500 px-2 py-1 font-bold text-white">
          {money(cash.atPickup)}
          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide">al retirar</span>
        </span>
      )}
    </div>
  );
}
