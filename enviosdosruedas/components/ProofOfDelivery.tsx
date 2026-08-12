'use client';

import Logo from '@/components/Logo';
import SiteFooter from '@/components/SiteFooter';
import { STATUS_LABEL, type ShipmentStatus } from '@/lib/format';
import { mapaEmbedUrl } from '@/lib/mapa';

export interface TrackResult {
  code: string;
  status: ShipmentStatus;
  isFlex: boolean;
  recipient: string;
  address: string;
  city: string;
  window: string | null;
  scheduledDate: string;
  createdAt: string;
  deliveredAt: string | null;
  lat: number | null;
  lng: number | null;
  proof: {
    event: 'entregado' | 'no_entregado';
    happenedAt: string;
    receiverName: string | null;
    failureReason: string | null;
    photoUrl: string | null;
  } | null;
  timeline: { event: string; happenedAt: string }[];
}

const MOTIVOS: Record<string, string> = {
  ausente: 'No había nadie',
  intransitable: 'Calle intransitable',
  direccion_incorrecta: 'Dirección incorrecta',
  telefono_incorrecto: 'Teléfono incorrecto',
  rechazado: 'Rechazado por el destinatario',
  otro: 'Otro motivo',
};

/** Cómo se le cuenta cada paso al cliente final. */
const HITOS: Record<string, string> = {
  creado: 'Envío registrado',
  asignado: 'Asignado a un repartidor',
  retirado: 'Retirado del comercio',
  en_camino: 'En camino a tu domicilio',
  entregado: 'Entregado',
  no_entregado: 'No se pudo entregar',
  reprogramado: 'Reprogramado',
  cancelado: 'Cancelado',
};

const fecha = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Comprobante de entrega (POD) para el cliente final.
 *
 * Sigue el formato habitual de la industria: sello de estado bien grande,
 * los datos del envío en dos columnas, la prueba (quién recibió y la foto) y
 * el pie con los datos de la empresa.
 */
export default function ProofOfDelivery({ data }: { data: TrackResult }) {
  const entregado = data.proof?.event === 'entregado';
  const fallido = data.proof?.event === 'no_entregado';
  const mapa = data.lat && data.lng ? mapaEmbedUrl(data.lat, data.lng) : null;

  /**
   * Sin foto, el mapa ocupa todo el ancho.
   *
   * Antes quedaba solo en la columna izquierda de una grilla de dos, con el
   * hueco vacío al lado: se veía corrido a un costado en vez de centrado.
   */
  const soloMapa = mapa && !data.proof?.photoUrl;

  return (
    <article className="overflow-hidden rounded-2xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)]">
      {/* ---------- Encabezado ---------- */}
      <header className="flex items-center gap-3 border-b-2 border-[var(--edr-yellow)] px-5 py-4">
        <Logo size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black leading-tight">Envíos DosRuedas</div>
          <div className="text-xs font-semibold uppercase tracking-widest text-[var(--edr-muted)]">
            Comprobante de entrega
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
            Seguimiento
          </div>
          <div className="edr-mono text-sm font-black">{data.code}</div>
        </div>
      </header>

      {/* ---------- Sello de estado ---------- */}
      <div className="px-5 pt-5">
        <div
          className={`rounded-xl border-4 px-4 py-4 text-center ${
            entregado
              ? 'border-emerald-400 bg-emerald-500/15'
              : fallido
                ? 'border-orange-400 bg-orange-500/15'
                : 'border-[var(--edr-yellow)] bg-[var(--edr-yellow)]/10'
          }`}
        >
          <div className="text-3xl font-black leading-none tracking-wide">
            {entregado
              ? 'ENTREGADO'
              : fallido
                ? 'NO ENTREGADO'
                : (HITOS[data.status] ?? STATUS_LABEL[data.status] ?? '').toUpperCase()}
          </div>
          {data.proof && (
            <div className="mt-2 text-sm font-bold text-[var(--edr-muted)]">
              {fecha(data.proof.happenedAt)}
            </div>
          )}
          {!data.proof && (
            <div className="mt-2 text-sm font-bold text-[var(--edr-muted)]">
              {data.status === 'en_camino'
                ? 'El repartidor ya salió con tu envío.'
                : data.status === 'retirado'
                  ? 'Ya lo retiramos del comercio.'
                  : 'Tu envío está en curso. Volvé a consultar más tarde.'}
            </div>
          )}
        </div>
      </div>

      {/* ---------- Datos ---------- */}
      <div className="grid grid-cols-1 gap-3 px-5 py-5 sm:grid-cols-2">
        <Dato label="Destinatario" value={data.recipient} />
        <Dato label="Localidad" value={data.city} />
        <Dato label="Dirección" value={data.address} className="sm:col-span-2" />
        <Dato label="Fecha de reparto" value={data.scheduledDate.split('-').reverse().join('/')} />
        <Dato label="Rango horario" value={data.window || 'Sin franja acordada'} />

        {data.proof?.receiverName && (
          <Dato label="Recibido por" value={data.proof.receiverName} className="sm:col-span-2" />
        )}
        {data.proof?.failureReason && (
          <Dato
            label="Motivo"
            value={MOTIVOS[data.proof.failureReason] ?? data.proof.failureReason}
            className="sm:col-span-2"
          />
        )}
        {data.isFlex && (
          <Dato
            label="Modalidad"
            value="Mercado Libre Flex — el detalle también figura en la app de Flex"
            className="sm:col-span-2"
          />
        )}
      </div>

      {/* ---------- Prueba ---------- */}
      {(data.proof?.photoUrl || mapa) && (
        <div className="grid grid-cols-1 gap-4 border-t border-[var(--edr-border)] px-5 py-5 sm:grid-cols-2">
          {data.proof?.photoUrl && (
            <figure>
              <figcaption className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
                Foto del comprobante
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada temporal */}
              <img
                src={data.proof.photoUrl}
                alt="Comprobante de entrega"
                className="h-64 w-full rounded-xl border-2 border-[var(--edr-border)] object-cover"
              />
            </figure>
          )}

          {mapa && (
            <figure className={soloMapa ? 'sm:col-span-2' : undefined}>
              <figcaption className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
                Punto de entrega
              </figcaption>
              <iframe
                src={mapa}
                title="Punto de entrega"
                className="h-64 w-full rounded-xl border-2 border-[var(--edr-border)]"
                loading="lazy"
              />
            </figure>
          )}
        </div>
      )}

      {/* ---------- Línea de tiempo ---------- */}
      {data.timeline.length > 0 && (
        <ol className="border-t border-[var(--edr-border)] px-5 py-4 text-sm">
          {data.timeline.map((t, i) => (
            <li key={i} className="flex items-baseline gap-3 py-1">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--edr-yellow)]" />
              <span className="font-bold">{HITOS[t.event] ?? t.event.replace('_', ' ')}</span>
              <span className="edr-mono ml-auto text-xs text-[var(--edr-muted)]">
                {fecha(t.happenedAt)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {/* ---------- Pie ---------- */}
      <footer className="border-t-2 border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] px-5 py-5">
        <p className="mb-3 text-center text-base font-black">
          Gracias por utilizar nuestros servicios
        </p>
        <SiteFooter compacto />
      </footer>

    </article>
  );
}

function Dato({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-[var(--edr-border)] px-4 py-3 ${className}`}>
      <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        {label}
      </div>
      <div className="text-base font-semibold leading-snug">{value}</div>
    </div>
  );
}
