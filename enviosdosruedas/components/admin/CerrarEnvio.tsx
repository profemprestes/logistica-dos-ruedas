'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { FAILURE_REASONS } from '@/components/driver/ResolveDeliveryModal';
import type { Shipment } from '@/lib/format';

type Cierre = 'entregado' | 'no_entregado';

/**
 * Cerrar un envío desde el panel, para bien o para mal.
 *
 * Existe porque el repartidor no siempre puede cerrarlo él: avisa por
 * teléfono, se queda sin batería, o cierra mal y hay que corregirlo.
 *
 * Lo importante es que ESCRIBE HISTORIAL, cosa que el desplegable de estado no
 * hace. Cambiar el estado ahí mueve una casilla; el seguimiento del cliente y
 * el comprobante se guían por los movimientos. Cuando esas dos cosas se
 * separan pasa lo que pasó: un envío corregido a entregado que seguía
 * mostrando NO ENTREGADO para siempre.
 *
 * Las dos opciones viven en el mismo cuadro a propósito. Son la misma decisión
 * —cómo terminó este envío— y separarlas en dos botones llenaba la fila de
 * acciones sin que se entendiera mejor.
 */
export default function CerrarEnvio({
  shipment,
  onCerrar,
  onListo,
}: {
  shipment: Shipment;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [tipo, setTipo] = useState<Cierre>('no_entregado');
  const [motivo, setMotivo] = useState('');
  const [recibio, setRecibio] = useState('');
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  async function guardar() {
    if (tipo === 'no_entregado' && !motivo) return setError('Elegí el motivo.');

    setGuardando(true);
    setError('');

    const { error: rpcError } =
      tipo === 'no_entregado'
        ? await supabase.rpc('marcar_no_entregado', {
            p_shipment_id: shipment.id,
            p_reason: motivo,
            p_comment: comentario.trim() || null,
          })
        : await supabase.rpc('marcar_entregado', {
            p_shipment_id: shipment.id,
            p_receiver_name: recibio.trim() || null,
            p_comment: comentario.trim() || null,
          });

    setGuardando(false);

    if (rpcError) {
      const m = rpcError.message;
      setError(
        m.includes('ENTREGA_YA_REGISTRADA')
          ? 'La entrega de ese envío ya está registrada. Si se cerró por error, marcalo como no entregado.'
          : m.includes('SOLO_ADMIN')
            ? 'Sólo un administrador puede hacer esto.'
            : m.includes('programado')
              ? 'Está cargado para otro día: cambiale la fecha de reparto antes de cerrarlo.'
              : m,
      );
      return;
    }

    onListo();
    onCerrar();
  }

  const solapa = (t: Cierre, texto: string, activo: string) =>
    tipo === t
      ? `flex-1 rounded px-3 py-2 text-sm font-black ${activo}`
      : 'flex-1 rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]';

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
            <h3 className="text-lg font-black">Cerrar envío</h3>
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

        <div className="mb-3 flex gap-2">
          <button
            onClick={() => setTipo('no_entregado')}
            className={solapa('no_entregado', 'No entregado', 'bg-orange-600 text-white')}
          >
            No entregado
          </button>
          <button
            onClick={() => setTipo('entregado')}
            className={solapa('entregado', 'Entregado', 'bg-emerald-600 text-white')}
          >
            Entregado
          </button>
        </div>

        {tipo === 'no_entregado' ? (
          <>
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
          </>
        ) : (
          <>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Quién recibió (opcional)
            </label>
            <input
              value={recibio}
              onChange={(e) => setRecibio(e.target.value)}
              placeholder="El encargado del edificio"
              className="mb-3 w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]"
            />
          </>
        )}

        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
          Comentario (opcional)
        </label>
        <textarea
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          rows={2}
          placeholder={
            tipo === 'no_entregado'
              ? 'El comercio avisó que no había nadie'
              : 'Lo cerró el repartidor por teléfono'
          }
          className="mb-3 w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]"
        />

        <p className="mb-3 text-xs text-[var(--edr-muted)]">
          {tipo === 'no_entregado'
            ? shipment.status === 'entregado'
              ? 'Este envío figura entregado: registrar un intento fallido lo devuelve a "pendiente de entrega" y le borra la fecha de entrega. Sirve para corregir un cierre equivocado.'
              : 'El motivo queda en el seguimiento del envío y en el comprobante. El envío pasa a "pendiente de entrega" para volver a intentarlo.'
            : 'Queda registrado como entregado, con la fecha de ahora y sin foto: un cierre hecho desde el panel no tiene la prueba que saca el repartidor.'}
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
            className={`rounded px-4 py-2 text-sm font-black text-white hover:brightness-110 disabled:opacity-50 ${
              tipo === 'no_entregado' ? 'bg-orange-600' : 'bg-emerald-600'
            }`}
          >
            {guardando
              ? 'Guardando…'
              : tipo === 'no_entregado'
                ? 'Registrar intento fallido'
                : 'Registrar entrega'}
          </button>
        </div>
      </div>
    </div>
  );
}
