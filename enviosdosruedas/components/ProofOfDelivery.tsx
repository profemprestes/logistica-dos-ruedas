'use client';

import dynamic from 'next/dynamic';
import Logo from '@/components/Logo';
import SiteFooter from '@/components/SiteFooter';
import { STATUS_LABEL, type ShipmentStatus } from '@/lib/format';
import { mapaEmbedUrl } from '@/lib/mapa';
import type { PuntoMapa } from '@/components/MapaEnvios';

/**
 * Leaflet toca `window` al cargar, y esto es una página pública que se
 * renderiza en el servidor. Además así sólo lo bajan los que abren un
 * seguimiento con la moto en la calle, que son los menos.
 */
const MapaEnvios = dynamic(() => import('@/components/MapaEnvios'), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-xl border-2 border-dashed border-[var(--edr-border)] text-sm text-[var(--edr-muted)]">
      Abriendo el mapa…
    </div>
  ),
});

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
  /**
   * Por dónde venía la moto, con unos minutos de atraso a propósito.
   * Sólo viene cuando el envío está en camino; el resto del tiempo es null.
   */
  courier: {
    lat: number;
    lng: number;
    /** Cuándo se tomó ese punto. Es varios minutos antes de ahora. */
    takenAt: string;
    eta: { texto: string; desde: number; hasta: number } | null;
  } | null;
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

/** Sólo la hora: en el mapa, la fecha sobra y ocupa la mitad del globito. */
const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

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
   * Los dos puntos del mapa mientras el envío viaja: adónde va y por dónde
   * venía la moto. Sin repartidor en la calle esto queda en null y se sigue
   * usando el recuadro de siempre.
   */
  const puntos: PuntoMapa[] | null =
    data.courier && data.lat != null && data.lng != null
      ? [
          {
            id: 1,
            lat: data.lat,
            lng: data.lng,
            etiqueta: '🏠',
            color: '#0636a5',
            titulo: 'Tu domicilio',
            detalle: data.address,
          },
          {
            id: 2,
            lat: data.courier.lat,
            lng: data.courier.lng,
            etiqueta: '🛵',
            color: '#ea580c',
            titulo: 'Por acá venía el repartidor',
            detalle: `Hace unos minutos · ${hora(data.courier.takenAt)}`,
          },
        ]
      : null;

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

      {/* ---------- Cuánto falta ---------- */}
      {data.courier && (
        <div className="px-5 pt-4">
          <div className="rounded-xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-yellow)]/10 px-4 py-4 text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--edr-muted)]">
              {data.courier.eta ? 'Llega aproximadamente en' : 'El repartidor está en la calle'}
            </div>
            <div className="mt-1 text-2xl font-black leading-tight sm:text-3xl">
              {data.courier.eta?.texto ?? 'En camino'}
            </div>
            {/* Decirlo, y no dejar que lo descubra: el número es una cuenta, no
                una promesa, y la posición del mapa no es la de ahora. */}
            <p className="mt-2 text-xs leading-snug text-[var(--edr-muted)]">
              Es un estimado: puede cambiar por el tránsito o por las entregas que tenga antes
              que la tuya. La posición en el mapa se muestra con unos minutos de demora.
            </p>
          </div>
        </div>
      )}

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
                {puntos ? 'Tu envío y por dónde viene' : 'Punto de entrega'}
              </figcaption>

              {/* Con la moto en la calle hacen falta dos puntos, y el recuadro
                  de OpenStreetMap sólo dibuja uno. Cuando no hay nada que
                  seguir se deja el recuadro, que es más liviano. */}
              {puntos ? (
                <MapaEnvios puntos={puntos} alto="h-64" />
              ) : (
                <iframe
                  src={mapa}
                  title="Punto de entrega"
                  className="h-64 w-full rounded-xl border-2 border-[var(--edr-border)]"
                  loading="lazy"
                />
              )}
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
