'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, RefreshCw } from 'lucide-react';
import Logo from '@/components/Logo';
import SiteFooter, { WHATSAPP } from '@/components/SiteFooter';
import { fechaHoraAR, STATUS_LABEL, type ShipmentStatus } from '@/lib/format';
import { mapaEmbedUrl } from '@/lib/mapa';
import { MINUTOS_SIN_NOVEDAD } from '@/lib/eta';
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
   * La zona por la que anda la moto: el centro de una celda de 500 metros, no
   * su posición exacta. Sólo viene cuando el envío está en camino.
   */
  courier: {
    /** Centro de la celda de 500 m, NO la posición exacta de la moto. */
    lat: number;
    lng: number;
    /** Metros del círculo que se dibuja alrededor. */
    radio: number;
    takenAt: string;
    /** Hace cuántos minutos se tomó. Viene calculado del servidor. */
    haceMinutos: number;
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
  // Va escrito acá y no se deja caer al nombre interno: "pendiente de retiro"
  // es como lo llama la base, y es lo que el destinatario tiene que leer.
  pendiente_retiro: 'Pendiente de retiro',
  retirado: 'Retirado del comercio',
  en_camino: 'En camino a tu domicilio',
  entregado: 'Entregado',
  no_entregado: 'No se pudo entregar',
  reprogramado: 'Reprogramado',
  cancelado: 'Cancelado',
};

/**
 * El color de la tarjeta de estado.
 *
 * Los cuatro son claros con texto oscuro, encima del azul de la página: es lo
 * que hace que el estado salte a la vista sin depender de leerlo. El verde de
 * entregado es el mismo #DCFCE7 del chip de la tabla, así que el que ve las dos
 * pantallas ve el mismo verde.
 */
function SELLO(cancelado: boolean, entregado: boolean, fallido: boolean): string {
  if (cancelado) return 'bg-[#FEE2E2] text-[#991B1B]';
  if (entregado) return 'bg-[#DCFCE7] text-[#166534]';
  if (fallido) return 'bg-[#FFEDD5] text-[#9A3412]';
  // En curso: el amarillo de la marca, y sobre amarillo el texto es el azul.
  return 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]';
}

/**
 * La casita del mapa, dibujada y no en emoji.
 *
 * El punto del mapa lo arma Leaflet con un texto de HTML, así que no se le
 * puede pasar un componente: va el dibujo escrito. Es el mismo ícono de Lucide
 * que usa el resto del sistema. Con emoji, cada celular ponía el suyo —una
 * casita distinta en Android que en iPhone, y de otro color— arriba de un
 * círculo azul de la marca.
 */
const CASITA =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" ' +
  'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" ' +
  'stroke-linejoin="round" style="display:block;margin:4px auto">' +
  '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/>' +
  '<path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
  '</svg>';

/** Hora de Mar del Plata, igual en el servidor que en el celular. Ver lib/format. */
const fecha = fechaHoraAR;

/** Ya no se mueven: no hay nada que refrescar ni que esperar. */
const CERRADOS: ShipmentStatus[] = ['entregado', 'cancelado'];

/**
 * Qué se le explica al que abre el seguimiento, según cómo esté el envío.
 *
 * Antes había una sola frase para todo lo que no fuera "en camino" o
 * "retirado": "tu envío está en curso, volvé a consultar más tarde". Debajo de
 * un sello que decía CANCELADO, eso era directamente falso, y en los estados
 * que necesitan que la persona haga algo —cancelado, no entregado— no decía
 * qué hacer.
 *
 * El orden importa: un envío cancelado está cancelado aunque antes haya tenido
 * un intento fallido, así que eso se mira primero.
 */
function explicacion(data: TrackResult): string {
  if (data.status === 'cancelado') {
    return 'Tu envío fue cancelado. Comunicate con el vendedor o con la mensajería si creés que es un error.';
  }

  // Mismo orden que el sello: primero lo que el envío ES.
  if (data.status === 'entregado' || data.proof?.event === 'entregado') return '';

  if (data.proof?.event === 'no_entregado') {
    return 'Tu envío no pudo ser entregado. Comunicate con tu vendedor o con la mensajería para coordinar la entrega.';
  }

  /*
   * Cada estado dice DÓNDE está el paquete y QUÉ falta, en ese orden.
   *
   * Antes casi todo caía en "está en curso, volvé a consultar más tarde", que
   * no dice ninguna de las dos cosas: el que lo lee sigue sin saber si el
   * paquete está en el comercio, en la moto o a la vuelta de su casa. Y "volvé
   * más tarde" le pasa el trabajo a él.
   */
  switch (data.status) {
    case 'creado':
      return 'Ya lo cargamos en el sistema. Falta que un repartidor lo pase a buscar por el comercio.';
    case 'pendiente_retiro':
      return 'Un repartidor está yendo al comercio a buscarlo.';
    case 'retirado':
      return 'Ya lo retiramos del comercio. Cuando salga a la calle vas a ver acá por dónde viene.';
    case 'en_camino':
      return 'El repartidor ya salió con tu envío.';
    case 'pendiente_entrega':
      return 'Tu envío está pendiente de entrega. Esto sucede porque se reprogramó una nueva visita para otro día.';
    default:
      return 'Tu envío está en curso. Volvé a consultar más tarde.';
  }
}

/**
 * Comprobante de entrega (POD) para el cliente final.
 *
 * Sigue el formato habitual de la industria: sello de estado bien grande,
 * los datos del envío en dos columnas, la prueba (quién recibió y la foto) y
 * el pie con los datos de la empresa.
 */
export default function ProofOfDelivery({ data: inicial }: { data: TrackResult }) {
  /**
   * El envío en camino se refresca solo: quien lo abre lo deja abierto
   * esperando, y una pantalla que no se mueve obliga a recargar a mano para
   * enterarse de que ya llegó.
   */
  const [data, setData] = useState(inicial);

  /**
   * El estimado cambia solo, y cuando cambia hay que decirlo: si no, la
   * persona que vio "10 minutos" y ahora lee "25" cree que el sistema le
   * mintió. Explicarle por qué cambió es la diferencia entre un aviso y un
   * enojo.
   */
  const [cambioDeTiempo, setCambioDeTiempo] = useState(false);
  const etaAnterior = useRef(inicial.courier?.eta?.texto ?? null);
  /** Mientras dura el toque al botón de actualizar. */
  const [buscando, setBuscando] = useState(false);

  /**
   * Vuelve a preguntar por el envío.
   *
   * La usan las tres formas de refrescar: el reloj mientras está en camino,
   * volver a la pestaña, y el botón. Una sola función para que las tres
   * traigan lo mismo y avisen igual cuando cambia el tiempo estimado.
   */
  const pedir = useCallback(async () => {
    try {
      const r = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: inicial.code }),
      });
      if (!r.ok) return;
      const nuevo: TrackResult = await r.json();

      const ahora = nuevo.courier?.eta?.texto ?? null;
      // Sólo si ya había un estimado antes: la primera vez que aparece no es
      // un cambio, es la primera noticia.
      if (ahora && etaAnterior.current && ahora !== etaAnterior.current) {
        setCambioDeTiempo(true);
        window.setTimeout(() => setCambioDeTiempo(false), 40_000);
      }
      etaAnterior.current = ahora;

      setData(nuevo);
    } catch {
      // Sin señal se queda con lo último que vio. No hay nada que avisar.
    }
  }, [inicial.code]);

  /** El botón. Se ve que hace algo aunque no haya cambiado nada. */
  async function actualizarAMano() {
    setBuscando(true);
    await pedir();
    // Un respiro para que el giro se vea: sin esto, con buena conexión el
    // botón parpadea y parece que no hizo nada.
    window.setTimeout(() => setBuscando(false), 400);
  }

  useEffect(() => {
    // El que está esperando no cierra la pestaña: la deja abierta. Mientras el
    // envío viaja se refresca solo, que es cuando cambia algo cada minuto.
    if (data.status !== 'en_camino') return;
    const timer = window.setInterval(pedir, 45_000);
    return () => window.clearInterval(timer);
  }, [data.status, pedir]);

  useEffect(() => {
    // Volver a la pestaña después de un rato es el momento en que más importa
    // que el dato esté fresco. Vale para todo lo que todavía se mueve, no sólo
    // para lo que está en camino: alguien que dejó abierto "retirado" a la
    // mañana vuelve a la tarde y quiere ver si ya salió.
    if (CERRADOS.includes(data.status)) return;
    const alVolver = () => {
      if (document.visibilityState === 'visible') void pedir();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [data.status, pedir]);

  /*
   * Manda el estado del envío, no el último movimiento.
   *
   * Antes el sello salía del registro más nuevo, y eso dejaba envíos
   * trabados: marcado "no entregado" y después corregido a entregado desde el
   * panel, el seguimiento seguía mostrando NO ENTREGADO para siempre, porque
   * cambiar el estado no escribe un registro nuevo.
   *
   * El estado es lo que el envío ES; los registros son lo que le PASÓ. Para el
   * sello vale el primero, y el historial completo sigue abajo en la línea de
   * tiempo y en el comprobante.
   */
  const cancelado = data.status === 'cancelado';
  const entregado = data.status === 'entregado' || data.proof?.event === 'entregado';
  const fallido = !cancelado && !entregado && data.proof?.event === 'no_entregado';

  /**
   * La fecha del sello sólo si corresponde a lo que el sello dice. Poner
   * debajo de "ENTREGADO" la fecha de un intento fallido es peor que no poner
   * ninguna.
   */
  const fechaSello =
    entregado && data.proof?.event === 'entregado'
      ? data.proof.happenedAt
      : entregado
        ? data.deliveredAt
        : fallido && data.proof
          ? data.proof.happenedAt
          : null;
  const mapa = data.lat && data.lng ? mapaEmbedUrl(data.lat, data.lng) : null;

  /**
   * Los dos puntos del mapa mientras el envío viaja: adónde va y la zona por
   * la que anda la moto. Sin repartidor en la calle esto queda en null y se
   * sigue usando el recuadro de siempre.
   */
  const puntos: PuntoMapa[] | null =
    data.courier && data.lat != null && data.lng != null
      ? [
          {
            id: 1,
            lat: data.lat,
            lng: data.lng,
            etiqueta: CASITA,
            color: '#0636a5',
            titulo: 'Tu domicilio',
            detalle: data.address,
          },
          {
            id: 2,
            lat: data.courier.lat,
            lng: data.courier.lng,
            radio: data.courier.radio,
            // No se dibuja: manda `imagen`. Queda por si algún día falta.
            etiqueta: '',
            imagen: '/logo-simple.webp',
            color: '#ea580c',
            titulo: 'Por acá anda el repartidor',
            detalle:
              data.courier.haceMinutos >= MINUTOS_SIN_NOVEDAD
                ? `Zona aproximada · hace ${data.courier.haceMinutos} min`
                : 'Zona aproximada',
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
          <div className="font-anton text-lg uppercase leading-[.9] tracking-[-.01em] text-white">
            Envíos<span className="text-[var(--edr-yellow)]">DosRuedas</span>
          </div>
          <div className="font-bebas text-sm tracking-[.1em] text-[var(--edr-muted)]">
            COMPROBANTE DE ENTREGA
          </div>
        </div>
        <div className="text-right">
          <div className="font-bebas text-xs tracking-[.1em] text-[var(--edr-muted)]">
            SEGUIMIENTO
          </div>
          <div className="edr-mono text-sm font-black">{data.code}</div>
        </div>
      </header>

      {/* ---------- Sello de estado ----------
          Tarjeta llena y no un recuadro: es lo primero y muchas veces lo único
          que mira el que abre el link, así que el estado tiene que leerse de
          lejos y de un vistazo. El color dice lo mismo que la palabra —verde
          entregado, amarillo en curso, naranja no entregado, rojo cancelado—
          para que se entienda antes de leer. */}
      <div className="px-5 pt-5">
        <div className={`rounded-2xl px-5 py-5 text-center ${SELLO(cancelado, entregado, fallido)}`}>
          <div className="font-anton text-[34px] uppercase leading-none tracking-[-.02em]">
            {cancelado
              ? 'CANCELADO'
              : entregado
                ? 'ENTREGADO'
                : fallido
                  ? 'NO ENTREGADO'
                  : (HITOS[data.status] ?? STATUS_LABEL[data.status] ?? '').toUpperCase()}
          </div>
          {fechaSello && (
            <div className="edr-mono mt-2 text-sm font-bold opacity-80">{fecha(fechaSello)}</div>
          )}

          {explicacion(data) && (
            <div className="mt-2 text-sm font-semibold opacity-90">{explicacion(data)}</div>
          )}

          {/* ---------- Cuánto falta ----------
              Va ADENTRO de la tarjeta de estado y no en un recuadro aparte: el
              estado y el tiempo son la misma noticia, y separados competían
              entre sí por la atención en la primera pantalla. */}
          {data.status === 'en_camino' && (
            <div className="mt-4 border-t-2 border-[var(--edr-blue)]/20 pt-4">
              <div className="font-bebas text-sm tracking-[.1em] opacity-75">
                {data.courier?.eta ? 'LLEGA APROXIMADAMENTE EN' : 'EL REPARTIDOR ESTÁ EN LA CALLE'}
              </div>
              <div className="mt-1 text-2xl font-black leading-tight sm:text-3xl">
                {data.courier?.eta?.texto ?? 'En camino'}
              </div>

              {/* Sin posición publicable todavía —los primeros minutos siempre, y
                  cada vez que el repartidor tiene el celular guardado— hay que
                  decir por qué no hay mapa. Una pantalla que no explica su propio
                  vacío se lee como rota. */}
              <p className="mt-2 text-xs font-medium leading-snug opacity-80">
                {data.courier ? (
                  <>
                    Es un estimado: puede cambiar por el tránsito o por las entregas que tenga
                    antes que la tuya. En el mapa, el círculo marca la zona por donde anda.
                  </>
                ) : (
                  <>
                    Ya salió con tu envío. En cuanto tengamos su posición vas a ver por qué zona
                    viene y cuánto falta.
                  </>
                )}
              </p>

              {/* De cuándo es lo que se está mostrando. Recién se dice cuando ya
                  pasó un rato: aclarar "hace 1 minuto" es ruido, y callarlo a los
                  veinte es dejar que alguien salga a la vereda al pedo. */}
              {data.courier && data.courier.haceMinutos >= MINUTOS_SIN_NOVEDAD && (
                <p className="mt-2 rounded-lg bg-[var(--edr-blue)]/10 px-3 py-2 text-xs font-bold">
                  Última señal del repartidor hace {data.courier.haceMinutos} minutos. Puede estar
                  más cerca de lo que marca el mapa.
                </p>
              )}

              {cambioDeTiempo && (
                <p className="mt-2 rounded-lg bg-[var(--edr-blue)] px-3 py-2 text-xs font-bold text-[var(--edr-yellow)]">
                  Actualizamos el tiempo de entrega. Puede pasar por demoras que tenga el
                  repartidor con otros envíos anteriores al tuyo.
                </p>
              )}
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
            /* Sin la aclaración de que el detalle está en la app de Flex: el
               que abre esto ya lo sabe, y en el comprobante sonaba a excusa. */
            value="MercadoLibre Flex"
            className="sm:col-span-2"
          />
        )}
      </div>

      {/* ---------- Actualizar ----------
          Mientras el envío viaja la pantalla se refresca sola, pero eso el que
          espera no lo sabe: se queda mirando un número quieto sin saber si es
          el de hace un rato. El botón es para eso, para poder pedirlo. En un
          envío ya cerrado no aparece: no hay nada que pueda cambiar. */}
      {!CERRADOS.includes(data.status) && (
        <div className="px-5 pt-4">
          <button
            onClick={actualizarAMano}
            disabled={buscando}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-full border-2 border-[var(--edr-yellow)] px-6 font-bebas text-lg tracking-[.07em] text-[var(--edr-yellow)] transition hover:bg-[var(--edr-surface-2)] disabled:opacity-70"
          >
            <RefreshCw
              size={18}
              strokeWidth={2.5}
              className={buscando ? 'animate-spin' : undefined}
            />
            {buscando ? 'BUSCANDO NOVEDADES…' : 'ACTUALIZAR'}
          </button>
        </div>
      )}

      {/* ---------- Escribirnos ----------
          El que abre esto y ve algo que no cuadra —la dirección mal, el envío
          parado hace horas, "no entregado" sin haber estado ausente— hoy tenía
          que salir a buscar por dónde avisar. Va con el código adentro del
          mensaje: del otro lado se busca una sola vez. */}
      <div className="px-5 pb-5">
        <a
          href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
            `Hola! Consulto por el envío ${data.code}.`,
          )}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[var(--edr-whatsapp)] px-6 font-bebas text-lg tracking-[.07em] text-white transition hover:brightness-95"
        >
          <MessageCircle size={20} strokeWidth={2.5} />
          ESCRIBINOS POR WHATSAPP
        </a>
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
                {puntos ? 'Tu envío y la zona del repartidor' : 'Punto de entrega'}
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
        <div className="border-t border-[var(--edr-border)] px-5 py-4">
          <div className="mb-2 font-bebas text-sm tracking-[.1em] text-[var(--edr-muted)]">
            EL RECORRIDO
          </div>
          {/* La línea que une los puntos se dibuja con un borde a la izquierda
              de cada renglón, así crece sola con los movimientos que haya. */}
          <ol className="text-sm">
            {data.timeline.map((t, i) => (
              <li
                key={i}
                className={`flex items-baseline gap-3 border-l-2 py-2 pl-4 ${
                  i === data.timeline.length - 1
                    ? 'border-transparent'
                    : 'border-[var(--edr-yellow)]/40'
                }`}
              >
                <span className="-ml-[21px] h-2.5 w-2.5 shrink-0 self-center rounded-full bg-[var(--edr-yellow)]" />
                <span className="font-bold">{HITOS[t.event] ?? t.event.replace('_', ' ')}</span>
                <span className="edr-mono ml-auto text-xs text-[var(--edr-muted)]">
                  {fecha(t.happenedAt)}
                </span>
              </li>
            ))}
          </ol>
        </div>
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
