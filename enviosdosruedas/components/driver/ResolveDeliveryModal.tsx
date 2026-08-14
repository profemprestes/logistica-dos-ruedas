'use client';

import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import PhotoInput from '@/components/driver/PhotoInput';
import { useToast } from '@/components/driver/Toast';
import { getFix, type Fix } from '@/lib/driver/geo';
import {
  borrarBorrador,
  dropFromRoute,
  guardarBorrador,
  isQueued,
  leerBorrador,
  queueDelivery,
  type DeliveryKind,
} from '@/lib/driver/db';
import { flushPending } from '@/lib/driver/sync';
import { money, shipmentCash, type Shipment } from '@/lib/format';

/** Los cinco motivos que se repiten en la calle. */
export const FAILURE_REASONS = [
  'Ausente',
  'Intransitable',
  'Dirección incorrecta',
  'Teléfono incorrecto',
  'Rechazado',
] as const;

const inputCls =
  'w-full rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-4 text-lg outline-none focus:border-[var(--edr-yellow)]';
const labelCls = 'mb-1 block text-sm font-bold uppercase tracking-wide text-[var(--edr-muted)]';

export default function ResolveDeliveryModal({
  shipment,
  kind,
  onClose,
  onResolved,
  onSynced,
}: {
  shipment: Shipment;
  kind: DeliveryKind;
  onClose: () => void;
  /** El tipo va con el aviso: la hoja de ruta lo usa para moverlo a
   *  "cerrados" sin tener que volver a preguntarle al servidor. */
  onResolved: (shipmentId: number, kind: DeliveryKind) => void;
  /** Se llama cuando termina de intentar el envío, para refrescar el contador. */
  onSynced: () => void;
}) {
  const toast = useToast();
  const [receiverName, setReceiverName] = useState('');
  const [receiverDni, setReceiverDni] = useState('');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  /**
   * Hasta que no se terminó de buscar el borrador no se guarda nada.
   *
   * Sin esta traba, el formulario recién abierto —vacío— se guardaría encima
   * del borrador que estamos por leer, y la foto que queríamos rescatar
   * desaparecería justo al abrir. El orden importa: primero leer, después
   * empezar a escribir.
   */
  const [cargado, setCargado] = useState(false);
  const [recuperado, setRecuperado] = useState(false);

  /*
   * RESCATE DE LO QUE HABÍA A MEDIO CARGAR.
   *
   * Cuando la app abre la cámara, el celular la manda al fondo y Android puede
   * matarla ahí para darle memoria. Los repartidores avisaron que a veces
   * tienen que reabrir dos y tres veces. Eso no se puede prohibir desde una
   * web; lo que sí se puede es que no cueste nada: al volver a tocar la misma
   * entrega, vuelve la foto que ya había sacado y lo que había escrito.
   */
  useEffect(() => {
    let vivo = true;

    leerBorrador(shipment.id, kind).then((b) => {
      if (!vivo) return;
      if (b) {
        setReceiverName(b.receiverName);
        setReceiverDni(b.receiverDni);
        setComment(b.comment);
        setReason(b.reason);
        setPhotos(b.photos);
        setRecuperado(b.photos.length > 0 || Boolean(b.receiverName || b.comment || b.reason));
      }
      setCargado(true);
    });

    return () => {
      vivo = false;
    };
  }, [shipment.id, kind]);

  /*
   * Se guarda con un respiro de medio segundo: escribir el nombre no tiene por
   * qué disparar una escritura por letra. La foto, que es lo caro de rehacer,
   * entra por el mismo camino.
   */
  useEffect(() => {
    if (!cargado) return;

    const t = setTimeout(() => {
      void guardarBorrador({
        shipmentId: shipment.id,
        kind,
        receiverName,
        receiverDni,
        comment,
        reason,
        photos,
      });
    }, 500);

    return () => clearTimeout(t);
  }, [cargado, shipment.id, kind, receiverName, receiverDni, comment, reason, photos]);

  /** Descarta lo recuperado y deja el formulario limpio. */
  function empezarDeNuevo() {
    setReceiverName('');
    setReceiverDni('');
    setComment('');
    setReason('');
    setPhotos([]);
    setRecuperado(false);
    void borrarBorrador();
  }

  // El GPS se toma en silencio apenas se abre el formulario: para cuando termine
  // de escribir el nombre, la posición ya está lista.
  useEffect(() => {
    let alive = true;
    getFix().then((f) => {
      if (alive) setFix(f);
    });
    return () => {
      alive = false;
    };
  }, []);

  const entregado = kind === 'entregado';
  const cash = shipmentCash(shipment);
  const flex = Boolean(shipment.is_flex);

  /**
   * Un FLEX entregado no pide nombre ni DNI: esos datos los toma la app de
   * Mercado Libre. La foto sí, y desde el paso 18 es obligatoria igual que en
   * cualquier otro envío: es la única prueba que queda de nuestro lado si
   * después el comercio reclama que el paquete no llegó.
   */
  const flexEntregado = flex && entregado;

  async function submit() {
    if (photos.length === 0)
      return setError(
        flexEntregado
          ? 'Falta la foto del paquete con la fachada de fondo.'
          : 'Falta la foto del comprobante.',
      );
    if (entregado && !flex && !receiverName.trim())
      return setError('Poné el nombre de quien recibe.');
    if (entregado && !flex && !receiverDni.trim()) return setError('Poné el DNI de quien recibe.');
    if (!entregado && !reason) return setError('Elegí el motivo.');

    setSaving(true);
    setError('');

    // Último intento de posición por si al abrir todavía no había enganchado.
    const position = fix ?? (await getFix(6000));

    try {
      const eventId = crypto.randomUUID();

      await queueDelivery({
        clientEventId: eventId,
        shipmentId: shipment.id,
        trackingCode: shipment.tracking_code,
        kind,
        reason: entregado ? null : reason,
        receiverName: entregado ? receiverName.trim() : null,
        receiverDni: entregado ? receiverDni.trim() : null,
        comment: comment.trim() || null,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        accuracy: position?.accuracy ?? null,
        happenedAt: new Date().toISOString(),
        photos,
        tries: 0,
        lastError: null,
      });

      // Ya está en la cola de verdad: el borrador no tiene nada más que hacer.
      await borrarBorrador();

      // Se saca de la hoja de ruta apenas queda guardado en el celular:
      // el envío ya está cerrado aunque todavía no haya subido.
      await dropFromRoute(shipment.id);
      onResolved(shipment.id, kind);

      const outcome = await flushPending();

      // La verdad no está en el resultado del flush sino en la cola: el reintento
      // automático corre en paralelo y puede haberla mandado él. Si eso pasaba,
      // este flush no encontraba nada que hacer, devolvía cero y avisábamos
      // "sin conexión" por una entrega que en realidad ya estaba en Supabase.
      const sigueEnCola = await isQueued(eventId);

      if (!sigueEnCola) {
        toast(entregado ? 'Entrega registrada.' : 'Envío marcado como no entregado.', 'ok');
      } else if (outcome.blocked > 0) {
        // Definitivo: no se va a poder mandar nunca. Que no quede esperando.
        toast(outcome.lastServerError ?? 'El servidor rechazó esta entrega.', 'error');
      } else if (outcome.serverFailures > 0) {
        // No es falta de señal: el servidor contestó y dijo que no. Hay que verlo.
        toast(`Guardado en el celular, pero el servidor lo rechazó: ${outcome.lastServerError}`, 'error');
      } else if (outcome.skipped) {
        toast('Guardado. Se está enviando…', 'info');
      } else {
        toast('Guardado sin conexión. Se enviará al recuperar señal.', 'warn');
      }

      if (!position) toast('Ojo: se guardó sin GPS (no había señal).', 'warn');

      // Recién ahora se sabe si quedó algo pendiente: antes de esto el contador
      // mostraba 1 porque la entrega todavía estaba en la cola.
      onSynced();
      onClose();
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : 'No se pudo guardar en el celular.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--edr-paper)]">
      <header
        className={`flex items-center justify-between px-4 py-3 ${
          entregado ? 'bg-emerald-600' : 'bg-orange-600'
        } text-white`}
      >
        <div className="min-w-0">
          <h2 className="text-xl font-black">{entregado ? 'Entregado' : 'No entregado'}</h2>
          <p className="edr-mono truncate text-xs opacity-90">{shipment.tracking_code}</p>
        </div>
        <button
          onClick={onClose}
          disabled={saving}
          className="rounded-lg bg-black/20 px-4 py-2 text-base font-bold disabled:opacity-50"
        >
          Volver
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-8">
        {recuperado && (
          <div className="rounded-xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-4 py-3">
            <p className="text-base font-bold">
              Recuperamos lo que habías cargado antes de que se cerrara la app.
            </p>
            <button
              type="button"
              onClick={empezarDeNuevo}
              className="mt-2 text-sm font-bold underline"
            >
              Empezar de nuevo
            </button>
          </div>
        )}

        <div className="rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
          <div className="text-lg font-bold">{shipment.recipient_name}</div>
          <div className="text-base">{shipment.address_street}</div>
        </div>

        {entregado && cash.atDelivery > 0 && (
          <div className="rounded-xl border-4 border-black bg-[var(--edr-hiviz)] text-black px-4 py-3 text-center">
            <div className="text-sm font-black uppercase tracking-wide">Cobrar antes de entregar</div>
            <div className="edr-mono text-4xl font-black">{money(cash.atDelivery)}</div>
          </div>
        )}

        {flexEntregado ? (
          <div className="rounded-2xl border-4 border-black bg-[var(--edr-yellow)] px-4 py-5 text-center text-black">
            <div className="text-3xl font-black leading-none">ENVÍO FLEX</div>
            <div className="mt-2 text-lg font-black leading-tight">
              COMPLETAR EN LA APP DE ENVÍOS FLEX
            </div>
            <p className="mt-3 text-sm font-bold leading-snug">
              Cerrá la entrega en la app de Envíos Flex y recién después confirmá acá.
              No hacen falta nombre ni DNI, pero la foto sí: sacá el paquete con la
              fachada de fondo.
            </p>
          </div>
        ) : entregado ? (
          <>
            <div>
              <label className={labelCls}>Nombre de quien recibe *</label>
              <input
                className={inputCls}
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={labelCls}>DNI *</label>
              <input
                className={`${inputCls} edr-mono`}
                value={receiverDni}
                onChange={(e) => setReceiverDni(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
              />
            </div>
          </>
        ) : (
          <div>
            <label className={labelCls}>Motivo *</label>
            <select
              className={inputCls}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="">Elegí un motivo…</option>
              {FAILURE_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Lo que la foto sola no cuenta: quién era el que abrió la puerta,
            dónde quedó el paquete. Es lo que después zanja una discusión con
            el comercio, así que va en el comprobante que se le manda. */}
        <div>
          <label className={labelCls}>Comentario (opcional)</label>
          <textarea
            className={inputCls}
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              entregado
                ? 'Recibió el encargado del edificio'
                : 'Toqué timbre tres veces, nadie contestó'
            }
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {(entregado
              ? ['Recibió el encargado', 'Dejado en portería', 'Recibió un vecino']
              : ['Nadie contestó', 'No vive más ahí', 'No quiso recibirlo']
            ).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setComment(s)}
                className="rounded-lg border-2 border-[var(--edr-border)] px-3 py-2 text-sm font-bold text-[var(--edr-muted)] active:scale-[0.98]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>
            {flexEntregado ? 'Foto del paquete con la fachada de fondo *' : 'Comprobante *'}
          </label>
          <PhotoInput
            photos={photos}
            onPhotos={setPhotos}
            etiquetaPrimera={
              flexEntregado ? 'Sacar foto del paquete y la fachada' : 'Sacar foto (obligatoria)'
            }
          />
        </div>

        <p className="flex items-center justify-center gap-1.5 text-center text-sm font-semibold text-[var(--edr-muted)]">
          <MapPin size={16} strokeWidth={2} className="shrink-0" />
          {fix ? `Ubicación tomada (±${Math.round(fix.accuracy)} m)` : 'Buscando ubicación…'}
        </p>

        {error && (
          <p className="rounded-xl bg-red-600 px-4 py-3 text-center text-base font-bold text-white">
            {error}
          </p>
        )}
      </div>

      <div className="border-t-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button
          onClick={submit}
          disabled={saving}
          className={`w-full rounded-2xl px-6 py-6 text-2xl font-black text-white active:scale-[0.99] disabled:opacity-60 ${
            entregado ? 'bg-emerald-600' : 'bg-orange-600'
          }`}
        >
          {saving ? 'Guardando…' : entregado ? 'Confirmar entrega' : 'Confirmar no entregado'}
        </button>
      </div>
    </div>
  );
}
