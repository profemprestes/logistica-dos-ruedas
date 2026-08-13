'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { FAILURE_REASONS } from '@/components/driver/ResolveDeliveryModal';
import type { Shipment } from '@/lib/format';

/**
 * Registrar un intento fallido desde el panel.
 *
 * Existe porque el repartidor no siempre puede cerrarlo él: avisa por
 * teléfono, se queda sin batería, o cierra mal y hay que corregirlo. Antes,
 * lo único que se podía hacer desde acá era mover el estado a "pendiente de
 * entrega", y eso NO deja registro: el seguimiento del cliente se guía por el
 * registro, así que el envío quedaba sin motivo, sin fecha y sin figurar en el
 * comprobante.
 *
 * Los mismos motivos que usa la app del repartidor, importados de ahí: si
 * mañana se agrega uno, se agrega en un solo lado.
 */
export default function MarcarNoEntregado({
  shipment,
  onCerrar,
  onListo,
}: {
  shipment: Shipment;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [motivo, setMotivo] = useState<string>('');
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function guardar() {
    if (!motivo) return setError('Elegí el motivo.');

    setGuardando(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('marcar_no_entregado', {
      p_shipment_id: shipment.id,
      p_reason: motivo,
      p_comment: comentario.trim() || null,
    });

    setGuardando(false);

    if (rpcError) {
      // Los errores de la función vienen con su nombre en mayúsculas; el resto
      // se muestra tal cual, que para eso está.
      const texto = rpcError.message.includes('ENVIO_YA_CERRADO')
        ? 'Ese envío ya está entregado o cancelado.'
        : rpcError.message.includes('SOLO_ADMIN')
          ? 'Sólo un administrador puede hacer esto.'
          : rpcError.message.includes('programado')
            ? 'Está cargado para otro día: cambiale la fecha de reparto antes de cerrarlo.'
            : rpcError.message;
      setError(texto);
      return;
    }

    onListo();
    onCerrar();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3"
      onClick={onCerrar}
    >
      <div
        className="my-8 w-full max-w-md rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-black">Marcar como no entregado</h3>
            <p className="edr-mono truncate text-xs text-[var(--edr-muted)]">
              {shipment.tracking_code}
            </p>
            <p className="truncate text-sm">{shipment.address_street}</p>
          </div>
          <button
            onClick={onCerrar}
            aria-label="Cerrar"
            className="shrink-0 rounded px-2 text-2xl leading-none text-[var(--edr-muted)]"
          >
            ×
          </button>
        </div>

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Motivo *
        </label>
        <div className="mb-3 flex flex-wrap gap-2">
          {FAILURE_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setMotivo(r)}
              className={`rounded border px-3 py-2 text-xs font-bold ${
                motivo === r
                  ? 'border-[var(--edr-yellow)] bg-[var(--edr-yellow)] text-black'
                  : 'border-[var(--edr-border)] hover:bg-[var(--edr-surface-2)]'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Comentario (opcional)
        </label>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={2}
          placeholder="El comercio avisó que no había nadie"
          className="mb-3 w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]"
        />

        {/* Que quede claro que esto se ve afuera: el motivo y el comentario van
            al seguimiento que abre el destinatario y al comprobante. */}
        <p className="mb-3 text-xs text-[var(--edr-muted)]">
          El motivo queda en el seguimiento del envío y en el comprobante. El envío pasa a
          &quot;pendiente de entrega&quot; para volver a intentarlo.
        </p>

        {error && (
          <p className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onCerrar}
            className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="rounded bg-orange-600 px-4 py-2 text-sm font-black text-white hover:brightness-110 disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Registrar intento fallido'}
          </button>
        </div>
      </div>
    </div>
  );
}
