'use client';

import Logo from '@/components/Logo';
import {
  EVENT_LABEL,
  REASON_LABEL,
  fechaHora,
  pideQuienRecibio,
  photoPaths,
  type ProofLog,
} from '@/lib/proof';
import { money, type Shipment } from '@/lib/format';

/**
 * El comprobante como se ve EN PAPEL, pero en la pantalla.
 *
 * POR QUÉ EXISTE. El comercio tenía que bajar el PDF para saber qué decía el
 * PDF. Eso es un archivo en la carpeta de descargas, un visor que se abre, y
 * en el celular a veces ni eso. Acá lo ve de una, y si le sirve lo baja.
 *
 * ES EL MISMO DOCUMENTO, no un resumen: mismo sello, mismos datos, mismas
 * fotos, mismo pie. Si esta pantalla dijera algo distinto del papel, el
 * comercio le mandaría a su cliente un archivo que no coincide con lo que él
 * mismo vio, y ahí se pierde la confianza en las dos cosas.
 *
 * DOS COSAS QUE EL PAPEL NO PUEDE. Acá la ubicación es un link que abre Google
 * Maps y las fotos se agrandan de un toque. En el PDF son texto e imagen y no
 * hay nada que tocar.
 *
 * VA EN BLANCO A PROPÓSITO, y es la única pantalla del sistema que lo está: no
 * es un panel, es la hoja. Se tiene que ver como lo que el comercio va a
 * imprimir o reenviar.
 */

const AZUL = '#0636a5';
const AZUL_OSCURO = '#00277c';
const GRIS = '#6b7280';
const LINEA = '#d4dcec';

const soloFecha = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

export default function ComprobanteEnPantalla({
  shipment,
  logs,
  urlDeFoto,
}: {
  shipment: Shipment;
  /** Ya filtrados a los movimientos que cierran el envío. */
  logs: ProofLog[];
  /** El link temporal de cada foto, o null mientras se está pidiendo. */
  urlDeFoto: (log: ProofLog, indice: number) => string | undefined;
}) {
  const cierre = logs[0] ?? null;
  const entregado = cierre?.event === 'entregado';
  const cancelado = cierre?.event === 'cancelado';

  const color = entregado ? '#047857' : cancelado ? '#4b5563' : cierre ? '#c2410c' : AZUL;
  const fondo = entregado ? '#ecfdf5' : cancelado ? '#f3f4f6' : cierre ? '#fff7ed' : '#eef4ff';
  const conReceptor = pideQuienRecibio(shipment);

  const direccion = [shipment.address_street, shipment.address_extra, shipment.city]
    .filter(Boolean)
    .join(', ');

  return (
    <div
      className="overflow-hidden rounded-lg"
      style={{ background: '#ffffff', color: '#111827', border: `1px solid ${LINEA}` }}
    >
      <div className="px-4 py-4 sm:px-6">
        {/* ------------------------------------------------ encabezado */}
        <div
          className="flex items-center gap-3 pb-3"
          style={{ borderBottom: '3px solid #ffec01' }}
        >
          {/* El mismo isotipo que el resto del sitio. El PDF usa `/icon.png`
              porque react-pdf no entiende webp, pero acá esa imagen no llega a
              dibujarse nunca —se pide, contesta 200 y queda a medio cargar—,
              así que en pantalla va el de siempre. */}
          <Logo size={44} className="shrink-0" />
          <div className="min-w-0">
            <div className="text-base font-black leading-tight" style={{ color: AZUL }}>
              Envíos DosRuedas
            </div>
            <div className="text-[10px] tracking-[0.15em]" style={{ color: GRIS }}>
              COMPROBANTE DE ENTREGA
            </div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-[9px] tracking-widest" style={{ color: GRIS }}>
              SEGUIMIENTO
            </div>
            <div className="edr-mono text-sm font-black" style={{ color: AZUL_OSCURO }}>
              {shipment.tracking_code}
            </div>
          </div>
        </div>

        {/* ----------------------------------------------------- sello */}
        <div
          className="my-4 rounded-md px-3 py-3 text-center"
          style={{ border: `2px solid ${color}`, background: fondo }}
        >
          <div className="text-xl font-black tracking-wider" style={{ color }}>
            {entregado
              ? 'ENTREGADO'
              : cancelado
                ? 'CANCELADO'
                : cierre
                  ? 'NO ENTREGADO'
                  : 'EN CURSO'}
          </div>
          <div className="mt-1 text-xs" style={{ color: GRIS }}>
            {cierre
              ? fechaHora(cierre.happened_at)
              : 'Este envío todavía no se cerró: el comprobante se completa al entregarlo.'}
          </div>
        </div>

        {/* ------------------------------------------ datos del envío */}
        <Titulo>DATOS DEL ENVÍO</Titulo>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          <Celda label="DESTINATARIO" value={shipment.recipient_name} />
          <Celda label="TELÉFONO" value={shipment.recipient_phone || '—'} />
          <Celda label="DIRECCIÓN" value={direccion} ancha />
          <Celda label="COMERCIO / REMITENTE" value={shipment.client_name_raw || '—'} />
          <Celda label="FECHA DE REPARTO" value={soloFecha(shipment.scheduled_date)} />
          <Celda label="FRANJA HORARIA" value={shipment.delivery_window || 'Sin franja acordada'} />
          <Celda label="PRODUCTO" value={shipment.product_detail || '—'} />
          {shipment.is_flex && <Celda label="MODALIDAD" value="MercadoLibre Flex" ancha />}
        </div>

        {/* ------------------------------------------ prueba de entrega */}
        <Titulo>PRUEBA DE ENTREGA</Titulo>

        {logs.length === 0 && (
          <p className="text-xs" style={{ color: GRIS }}>
            Este envío todavía no se cerró: el comprobante se completa cuando el repartidor registre
            la entrega o el intento fallido.
          </p>
        )}

        {logs.map((log) => {
          const fallido = log.event === 'no_entregado';
          const paths = photoPaths(log);

          return (
            <div
              key={log.id}
              className="mb-2.5 rounded-md p-3"
              style={{ border: `1px solid ${LINEA}` }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className="text-sm font-black"
                  style={{ color: fallido ? '#c2410c' : '#111827' }}
                >
                  {EVENT_LABEL[log.event] ?? log.event}
                </span>
                <span className="text-xs" style={{ color: GRIS }}>
                  {fechaHora(log.happened_at)}
                </span>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="w-full shrink-0 space-y-2 sm:w-[150px]">
                  {paths.length === 0 && (
                    <div
                      className="flex h-32 items-center justify-center rounded text-xs"
                      style={{ border: `1px dashed ${LINEA}`, color: GRIS }}
                    >
                      Sin foto
                    </div>
                  )}
                  {paths.map((_, i) => {
                    const url = urlDeFoto(log, i);
                    return url ? (
                      <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Comprobante ${i + 1}`}
                          className="w-full rounded object-cover"
                          style={{ border: `1px solid ${LINEA}` }}
                        />
                      </a>
                    ) : (
                      <div
                        key={i}
                        className="flex h-32 items-center justify-center rounded text-xs"
                        style={{ border: `1px dashed ${LINEA}`, color: GRIS }}
                      >
                        Cargando foto…
                      </div>
                    );
                  })}
                </div>

                <dl className="min-w-0 flex-1 space-y-1 text-xs">
                  {log.event === 'entregado' && conReceptor && (
                    <>
                      <Dato label="Recibió" valor={log.receiver_name || '—'} />
                      <Dato label="DNI" valor={log.receiver_dni || '—'} />
                    </>
                  )}

                  {fallido && (
                    <Dato
                      label="Motivo"
                      valor={REASON_LABEL[log.failure_reason ?? ''] ?? log.failure_reason ?? '—'}
                    />
                  )}

                  {log.comment && <Dato label="Comentario" valor={log.comment} />}

                  {log.amount_collected !== null && (
                    <Dato label="Cobró" valor={money(log.amount_collected)} />
                  )}

                  <div className="flex gap-1.5">
                    <dt className="font-bold">Ubicación:</dt>
                    <dd className="min-w-0">
                      {log.lat != null && log.lng != null ? (
                        <>
                          {/* Acá sí es un link: en el papel es texto y no lleva
                              a ningún lado. */}
                          <a
                            className="font-semibold underline"
                            style={{ color: AZUL }}
                            href={`https://www.google.com/maps/search/?api=1&query=${log.lat},${log.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Ver en Google Maps
                          </a>
                          {log.gps_accuracy != null && (
                            <span className="ml-1.5" style={{ color: GRIS }}>
                              (precisión ±{Math.round(log.gps_accuracy)} m)
                            </span>
                          )}
                        </>
                      ) : (
                        'No registrada'
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          );
        })}
      </div>

      {/* ------------------------------------------------------- pie */}
      <div
        className="px-4 py-3 text-center sm:px-6"
        style={{ borderTop: '2px solid #ffec01' }}
      >
        <div className="text-sm font-black" style={{ color: AZUL }}>
          www.enviosdosruedas.com
        </div>
        <div className="mt-0.5 text-[10px] leading-snug" style={{ color: GRIS }}>
          WhatsApp 2236602699 · Mensajería y logística de última milla · Mar del Plata, Argentina
          <br />
          Verificable en www.logisticadosruedas.com/seguimiento con el código{' '}
          {shipment.tracking_code}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ piezas */

function Titulo({ children }: { children: string }) {
  return (
    <div
      className="mb-1.5 mt-4 text-[10px] font-black tracking-[0.12em]"
      style={{ color: AZUL }}
    >
      {children}
    </div>
  );
}

function Celda({ label, value, ancha = false }: { label: string; value: string; ancha?: boolean }) {
  return (
    <div
      className={`rounded px-2 py-1.5 ${ancha ? 'sm:col-span-2' : ''}`}
      style={{ border: `1px solid ${LINEA}` }}
    >
      <div className="text-[9px] tracking-wide" style={{ color: GRIS }}>
        {label}
      </div>
      <div className="text-xs font-bold">{value}</div>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="font-bold">{label}:</dt>
      <dd className="min-w-0 break-words">{valor}</dd>
    </div>
  );
}
