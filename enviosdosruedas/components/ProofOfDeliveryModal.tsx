'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { money, type Shipment } from '@/lib/format';
import {
  EVENT_LABEL,
  REASON_LABEL,
  downloadPhoto,
  fechaHora,
  photoAsDataUrl,
  photoFileName,
  photoPaths,
  saveBlob,
  signedPhotoUrl,
  type ProofLog,
} from '@/lib/proof';

/** Una entrega puede tener dos fotos: la clave lleva cuál de las dos es. */
const fotoKey = (logId: string, indice: number) => `${logId}:${indice}`;

export default function ProofOfDeliveryModal({
  shipment,
  onClose,
}: {
  shipment: Shipment | null;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<ProofLog[]>([]);
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** Id del log cuya foto se está bajando, o 'pdf' mientras se arma el archivo. */
  const [bajando, setBajando] = useState('');

  useEffect(() => {
    if (!shipment) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setError('');
      setNotice('');
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

      const list = (data ?? []) as ProofLog[];
      setLogs(list);
      setLoading(false);

      // Las fotos están en un bucket privado: hay que pedir un link temporal.
      for (const log of list) {
        const paths = photoPaths(log);
        for (let i = 0; i < paths.length; i++) {
          const url = await signedPhotoUrl(paths[i]);
          if (!alive) return;
          if (url) setPhotos((p) => ({ ...p, [fotoKey(log.id, i)]: url }));
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [shipment]);

  if (!shipment) return null;

  const avisar = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  async function bajarFoto(log: ProofLog, indice: number) {
    const path = photoPaths(log)[indice];
    if (!path || !shipment) return;
    setBajando(fotoKey(log.id, indice));
    setError('');
    try {
      await downloadPhoto(path, photoFileName(shipment.tracking_code, log, indice));
      avisar('Foto descargada.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo bajar la foto.');
    }
    setBajando('');
  }

  /**
   * Los datos en texto plano, para pegarlos en la app del cliente cuando hay
   * que cerrar el envío de su lado a mano.
   */
  async function copiarDatos(log: ProofLog) {
    if (!shipment) return;
    const partes = [
      `Envío: ${shipment.tracking_code}`,
      `Destinatario: ${shipment.recipient_name}`,
      `Dirección: ${shipment.address_street}${shipment.address_extra ? ` ${shipment.address_extra}` : ''}, ${shipment.city}`,
      `Estado: ${EVENT_LABEL[log.event] ?? log.event}`,
      `Fecha y hora: ${fechaHora(log.happened_at)}`,
      log.receiver_name ? `Recibió: ${log.receiver_name}` : '',
      log.receiver_dni ? `DNI: ${log.receiver_dni}` : '',
      log.failure_reason
        ? `Motivo: ${REASON_LABEL[log.failure_reason] ?? log.failure_reason}`
        : '',
      log.comment ? `Comentario: ${log.comment}` : '',
      log.amount_collected !== null ? `Cobrado: ${money(log.amount_collected)}` : '',
      log.lat != null && log.lng != null ? `Ubicación: ${log.lat}, ${log.lng}` : '',
    ].filter(Boolean);

    try {
      await navigator.clipboard.writeText(partes.join('\n'));
      avisar('Datos copiados: pegalos en la app del cliente.');
    } catch {
      setError('El navegador no dejó copiar. Seleccioná el texto a mano.');
    }
  }

  /** Arma el PDF en el navegador y lo baja como archivo. */
  async function bajarPDF() {
    if (!shipment) return;
    setBajando('pdf');
    setError('');
    try {
      // La librería pesa: se carga recién cuando se aprieta el botón, así no
      // suma medio mega a la carga del panel.
      const [{ pdf }, { default: ProofPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/proof/ProofPdfDocument'),
      ]);

      // Las fotos van embebidas: el link firmado vence en una hora y el PDF no.
      const fotos: Record<string, string[]> = {};
      for (const log of logs) {
        const urls: string[] = [];
        for (const path of photoPaths(log)) {
          const dataUrl = await photoAsDataUrl(path);
          if (dataUrl) urls.push(dataUrl);
        }
        if (urls.length > 0) fotos[log.id] = urls;
      }

      const blob = await pdf(
        <ProofPdfDocument
          shipment={shipment}
          logs={logs}
          fotos={fotos}
          generadoEl={new Date()}
        />
      ).toBlob();

      saveBlob(blob, `${shipment.tracking_code}-comprobante.pdf`);
      avisar('Comprobante descargado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el PDF.');
    }
    setBajando('');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-2 sm:p-4">
      <div className="my-2 w-full max-w-3xl rounded-lg bg-[var(--edr-surface)] shadow-xl sm:my-6">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--edr-border)] px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Prueba de entrega</h2>
            <p className="edr-mono truncate text-xs text-[var(--edr-muted)]">
              {shipment.tracking_code}
            </p>
          </div>

          <button
            onClick={bajarPDF}
            disabled={bajando === 'pdf' || loading}
            className="ml-auto shrink-0 rounded bg-[var(--edr-yellow)] px-3 py-2 text-sm font-black text-black hover:brightness-95 disabled:opacity-50"
          >
            {bajando === 'pdf' ? 'Armando…' : '⬇ PDF'}
          </button>

          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="shrink-0 rounded px-2 py-1 text-2xl leading-none text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
          >
            ×
          </button>
        </div>

        <div className="px-4 py-4 sm:px-5 sm:py-5">
          <div className="mb-4 rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] p-3 text-sm">
            <div className="font-semibold">{shipment.recipient_name}</div>
            <div className="text-[var(--edr-muted)]">
              {shipment.address_street}
              {shipment.address_extra ? ` — ${shipment.address_extra}` : ''}, {shipment.city}
            </div>
          </div>

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

          {loading && <p className="py-6 text-center text-[var(--edr-muted)]">Cargando…</p>}

          {!loading && logs.length === 0 && (
            <p className="py-8 text-center text-[var(--edr-muted)]">
              Todavía no hay movimientos registrados para este envío.
            </p>
          )}

          <div className="space-y-4">
            {logs.map((log) => {
              const isFailure = log.event === 'no_entregado';
              const paths = photoPaths(log);
              return (
                <div
                  key={log.id}
                  className={`rounded-lg border p-3 sm:p-4 ${
                    isFailure
                      ? 'border-orange-400 bg-orange-950/40'
                      : 'border-[var(--edr-border)] bg-[var(--edr-surface)]'
                  }`}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-base font-bold">
                      {EVENT_LABEL[log.event] ?? log.event}
                    </span>
                    <span className="text-sm text-[var(--edr-muted)]">
                      {fechaHora(log.happened_at)}
                    </span>
                    {log.driver?.full_name && (
                      <span className="rounded bg-[var(--edr-surface-2)] px-2 py-0.5 text-xs font-semibold">
                        {log.driver.full_name}
                      </span>
                    )}
                    {log.synced_offline && (
                      <span className="rounded bg-sky-900 px-2 py-0.5 text-xs font-semibold text-sky-100">
                        Registrado sin señal
                      </span>
                    )}

                    <button
                      onClick={() => copiarDatos(log)}
                      className="ml-auto rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                    >
                      Copiar datos
                    </button>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                    {/* Fotos: una obligatoria y, si el repartidor la sacó, una segunda. */}
                    <div className="space-y-3">
                      {paths.length === 0 && (
                        <div className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--edr-border)] text-xs text-[var(--edr-muted)]">
                          Sin foto
                        </div>
                      )}

                      {paths.map((_, i) => {
                        const url = photos[fotoKey(log.id, i)];
                        const cargando = bajando === fotoKey(log.id, i);

                        if (!url) {
                          return (
                            <div
                              key={i}
                              className="flex h-32 items-center justify-center rounded border border-dashed border-[var(--edr-border)] text-xs text-[var(--edr-muted)]"
                            >
                              Cargando foto…
                            </div>
                          );
                        }

                        return (
                          <div key={i}>
                            <a href={url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt={`Comprobante ${i + 1}`}
                                className="w-full rounded border border-[var(--edr-border)] object-cover"
                              />
                            </a>
                            <button
                              onClick={() => bajarFoto(log, i)}
                              disabled={cargando}
                              className="mt-1 w-full rounded border border-[var(--edr-border)] px-2 py-1.5 text-xs font-semibold hover:bg-[var(--edr-surface-2)] disabled:opacity-50"
                            >
                              {cargando
                                ? 'Bajando…'
                                : paths.length > 1
                                  ? `⬇ Bajar foto ${i + 1}`
                                  : '⬇ Bajar foto'}
                            </button>
                          </div>
                        );
                      })}
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
                          <dd className="inline font-bold text-orange-200">
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
                              className="font-semibold text-sky-300 underline"
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
                          Subido a las {fechaHora(log.created_at)}
                        </div>
                      )}
                    </dl>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end border-t border-[var(--edr-border)] px-4 py-3 sm:px-5 sm:py-4">
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
