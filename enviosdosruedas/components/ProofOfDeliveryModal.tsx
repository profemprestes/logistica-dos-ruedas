'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { money, type Shipment } from '@/lib/format';

interface Log {
  id: string;
  event: string;
  receiver_name: string | null;
  receiver_dni: string | null;
  failure_reason: string | null;
  comment: string | null;
  photo_path: string | null;
  lat: number | null;
  lng: number | null;
  gps_accuracy: number | null;
  amount_collected: number | null;
  happened_at: string;
  created_at: string;
  synced_offline: boolean;
  driver?: { full_name: string } | null;
}

const EVENT_LABEL: Record<string, string> = {
  creado: 'Creado',
  asignado: 'Asignado',
  retirado: 'Retirado',
  en_camino: 'En camino',
  entregado: 'Entregado',
  no_entregado: 'No entregado',
  reprogramado: 'Reprogramado',
  cancelado: 'Cancelado',
};

const REASON_LABEL: Record<string, string> = {
  ausente: 'Cliente ausente',
  intransitable: 'Zona intransitable',
  direccion_incorrecta: 'Dirección incorrecta',
  telefono_incorrecto: 'Teléfono incorrecto',
  rechazado: 'Paquete rechazado',
  otro: 'Otro motivo',
};

export default function ProofOfDeliveryModal({
  shipment,
  onClose,
}: {
  shipment: Shipment | null;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!shipment) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setError('');
      setPhotos({});

      const { data, error: dbError } = await supabase
        .from('delivery_logs')
        .select('*, driver:driver_id(full_name)')
        .eq('shipment_id', shipment.id)
        .order('happened_at', { ascending: false });

      if (!alive) return;
      if (dbError) {
        setError(dbError.message);
        setLoading(false);
        return;
      }

      const list = (data ?? []) as Log[];
      setLogs(list);
      setLoading(false);

      // Las fotos están en un bucket privado: hay que pedir un link temporal
      const withPhoto = list.filter((l) => l.photo_path);
      for (const log of withPhoto) {
        const { data: signed } = await supabase.storage
          .from('delivery-photos')
          .createSignedUrl(log.photo_path as string, 3600);
        if (alive && signed?.signedUrl) {
          setPhotos((p) => ({ ...p, [log.id]: signed.signedUrl }));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [shipment]);

  if (!shipment) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-6 w-full max-w-3xl rounded-lg bg-[var(--edr-surface)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--edr-border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">Prueba de entrega</h2>
            <p className="edr-mono text-xs text-[var(--edr-muted)]">{shipment.tracking_code}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="mb-5 rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] p-3 text-sm">
            <div className="font-semibold">{shipment.recipient_name}</div>
            <div className="text-[var(--edr-muted)]">
              {shipment.address_street}
              {shipment.address_extra ? ` — ${shipment.address_extra}` : ''}, {shipment.city}
            </div>
          </div>

          {loading && <p className="py-6 text-center text-[var(--edr-muted)]">Cargando…</p>}

          {error && (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          {!loading && logs.length === 0 && (
            <p className="py-8 text-center text-[var(--edr-muted)]">
              Todavía no hay movimientos registrados para este envío.
            </p>
          )}

          <div className="space-y-4">
            {logs.map((log) => {
              const isFailure = log.event === 'no_entregado';
              return (
                <div
                  key={log.id}
                  className={`rounded-lg border p-4 ${
                    isFailure ? 'border-orange-300 bg-orange-50/60' : 'border-[var(--edr-border)] bg-[var(--edr-surface)]'
                  }`}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base font-bold">
                      {EVENT_LABEL[log.event] ?? log.event}
                    </span>
                    <span className="text-sm text-[var(--edr-muted)]">
                      {new Date(log.happened_at).toLocaleString('es-AR')}
                    </span>
                    {log.driver?.full_name && (
                      <span className="rounded bg-[var(--edr-surface-2)] px-2 py-0.5 text-xs font-semibold">
                        {log.driver.full_name}
                      </span>
                    )}
                    {log.synced_offline && (
                      <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                        Registrado sin señal
                      </span>
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                    {/* Foto */}
                    <div>
                      {log.photo_path ? (
                        photos[log.id] ? (
                          <a href={photos[log.id]} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={photos[log.id]}
                              alt="Comprobante"
                              className="w-full rounded border border-[var(--edr-border)] object-cover"
                            />
                            <span className="mt-1 block text-center text-xs text-[var(--edr-muted)]">
                              Tocá para ampliar
                            </span>
                          </a>
                        ) : (
                          <div className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--edr-border)] text-xs text-[var(--edr-muted)]">
                            Cargando foto…
                          </div>
                        )
                      ) : (
                        <div className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--edr-border)] text-xs text-[var(--edr-muted)]">
                          Sin foto
                        </div>
                      )}
                    </div>

                    {/* Datos */}
                    <dl className="space-y-1.5 text-sm">
                      {log.event === 'entregado' && (
                        <>
                          <div>
                            <dt className="inline font-semibold">Recibió: </dt>
                            <dd className="inline">{log.receiver_name || '—'}</dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold">DNI: </dt>
                            <dd className="edr-mono inline">{log.receiver_dni || '—'}</dd>
                          </div>
                        </>
                      )}

                      {isFailure && (
                        <div>
                          <dt className="inline font-semibold">Motivo: </dt>
                          <dd className="inline font-bold text-orange-900">
                            {REASON_LABEL[log.failure_reason ?? ''] ?? log.failure_reason ?? '—'}
                          </dd>
                        </div>
                      )}

                      {log.comment && (
                        <div>
                          <dt className="inline font-semibold">Comentario: </dt>
                          <dd className="inline">{log.comment}</dd>
                        </div>
                      )}

                      {log.amount_collected !== null && (
                        <div>
                          <dt className="inline font-semibold">Cobró: </dt>
                          <dd className="edr-mono inline font-bold">
                            {money(log.amount_collected)}
                          </dd>
                        </div>
                      )}

                      <div>
                        <dt className="inline font-semibold">Ubicación: </dt>
                        <dd className="inline">
                          {log.lat != null && log.lng != null ? (
                            <a
                              className="font-semibold text-blue-700 underline"
                              href={`https://www.google.com/maps/search/?api=1&query=${log.lat},${log.lng}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Ver en Google Maps
                            </a>
                          ) : (
                            '—'
                          )}
                          {log.gps_accuracy != null && (
                            <span className="ml-2 text-xs text-[var(--edr-muted)]">
                              (precisión ±{Math.round(log.gps_accuracy)} m)
                            </span>
                          )}
                        </dd>
                      </div>

                      {log.synced_offline && (
                        <div className="text-xs text-[var(--edr-muted)]">
                          Subido a las {new Date(log.created_at).toLocaleString('es-AR')}
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end border-t border-[var(--edr-border)] px-5 py-4">
          <button
            onClick={onClose}
            className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
