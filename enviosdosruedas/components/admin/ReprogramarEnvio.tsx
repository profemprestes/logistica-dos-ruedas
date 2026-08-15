'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { hoyLocal } from '@/lib/scheduled';
import { dayShift } from '@/lib/settlement';
import type { Shipment } from '@/lib/format';

/**
 * Volver a intentar un envío que no se pudo entregar.
 *
 * Parte el envío en dos: el intento fallido se queda quieto en su día —con su
 * motivo y su historial, para que el viaje que hizo el repartidor no
 * desaparezca de esa jornada— y nace uno nuevo para la fecha que se elija.
 *
 * Lo que sorprende al leerlo es qué pasa con el código, así que se explica en
 * pantalla: el CÓDIGO SE QUEDA CON EL ENVÍO NUEVO y el intento fallido se
 * archiva con un sufijo. Es al revés de lo que uno esperaría, y es lo que hace
 * que la etiqueta ya pegada en el paquete siga escaneando bien y que el link
 * que le pasaste al cliente le muestre el intento que viene.
 *
 * Y LA OTRA SALIDA. A veces el comercio nunca contesta, o contesta que ya no
 * va. Esos envíos se quedaban en "no entregado" para siempre; ahora el Panel
 * del día los muestra todos los días, así que hace falta poder decir "no se
 * reintenta" y que el motivo quede escrito. Es la segunda pantalla de este
 * mismo cuadro, y llegar a ella cuesta un toque más a propósito: cancelar no
 * se deshace.
 */
function Aviso({ texto }: { texto: string }) {
  return (
    <p className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
      {texto}
    </p>
  );
}

export default function ReprogramarEnvio({
  shipment,
  onCerrar,
  onListo,
}: {
  shipment: Shipment;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const manana = dayShift(hoyLocal(), 1);
  const [fecha, setFecha] = useState(manana);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  /** Qué se está por hacer. Se entra por la primera. */
  const [pantalla, setPantalla] = useState<'reprogramar' | 'no-va'>('reprogramar');
  const [motivo, setMotivo] = useState('');

  /** Traduce lo que devuelve la base a algo que se pueda leer. */
  function explicar(m: string): string {
    if (m.includes('SOLO_ADMIN')) return 'Sólo un administrador puede hacer esto.';
    if (m.includes('NO_ESTA_PARA_REPROGRAMAR'))
      return 'Esto sólo se hace con un envío que quedó como no entregado.';
    if (m.includes('YA_REPROGRAMADO')) return 'Este envío ya se reprogramó.';
    if (m.includes('FECHA_PASADA')) return 'Esa fecha ya pasó. Elegí hoy o un día que venga.';
    return m;
  }

  async function guardar() {
    setGuardando(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('reprogramar_envio', {
      p_shipment_id: shipment.id,
      p_fecha: fecha,
    });

    setGuardando(false);

    if (rpcError) {
      setError(explicar(rpcError.message));
      return;
    }

    onListo();
    onCerrar();
  }

  /** No se reintenta: el envío se cierra cancelado, con el motivo escrito. */
  async function cancelar() {
    setGuardando(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('cancelar_sin_reprogramar', {
      p_shipment_id: shipment.id,
      p_motivo: motivo,
    });

    setGuardando(false);

    if (rpcError) {
      setError(explicar(rpcError.message));
      return;
    }

    onListo();
    onCerrar();
  }

  const atajo = (valor: string, texto: string) => (
    <button
      type="button"
      onClick={() => setFecha(valor)}
      className={`flex-1 rounded px-3 py-2 text-sm font-bold ${
        fecha === valor
          ? 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
          : 'border border-[var(--edr-border)] hover:bg-[var(--edr-surface-2)]'
      }`}
    >
      {texto}
    </button>
  );

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
            <h3 className="text-lg font-black">
              {pantalla === 'reprogramar' ? 'Reprogramar' : 'No se reintenta'}
            </h3>
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

        {pantalla === 'reprogramar' ? (
          <>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Para cuándo
            </label>
            <div className="mb-2 flex gap-2">
              {atajo(manana, 'Mañana')}
              {atajo(hoyLocal(), 'Hoy')}
            </div>
            <input
              type="date"
              value={fecha}
              min={hoyLocal()}
              onChange={(e) => setFecha(e.target.value)}
              className="mb-3 w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]"
            />

            <div className="mb-3 rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-xs text-[var(--edr-muted)]">
              <p className="mb-1 font-bold text-[var(--edr-ink)]">Qué va a pasar</p>
              <p>
                El intento fallido se queda en su día y se archiva como{' '}
                <span className="edr-mono">{shipment.tracking_code}-1</span>, con el motivo y la
                prueba.
              </p>
              <p className="mt-1">
                El envío nuevo se queda con{' '}
                <span className="edr-mono">{shipment.tracking_code}</span>: la etiqueta pegada en el
                paquete sigue escaneando bien, y el link que le pasaste al cliente le muestra este
                intento.
              </p>
              {shipment.assigned_driver && (
                <p className="mt-1">Queda con el mismo repartidor, que es quien tiene el paquete.</p>
              )}
            </div>

            {error && <Aviso texto={error} />}

            <div className="flex justify-end gap-2">
              <button
                onClick={onCerrar}
                className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
              >
                Cerrar
              </button>
              <button
                onClick={guardar}
                disabled={guardando || !fecha}
                className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
              >
                {guardando ? 'Reprogramando…' : 'Reprogramar'}
              </button>
            </div>

            {/* La otra salida. Va abajo, separada y sin color de acción: no es
                lo que se hace casi nunca, y no se puede deshacer. */}
            <button
              onClick={() => {
                setError('');
                setPantalla('no-va');
              }}
              className="mt-4 w-full border-t border-[var(--edr-border)] pt-3 text-left text-xs text-[var(--edr-muted)] hover:text-[var(--edr-ink)]"
            >
              El cliente no confirmó, o ya no lo quiere →{' '}
              <span className="font-bold">no reprogramarlo</span>
            </button>
          </>
        ) : (
          <>
            <div className="mb-3 rounded border border-[var(--edr-naranja)] bg-[var(--edr-surface-2)] px-3 py-2 text-xs text-[var(--edr-muted)]">
              <p className="mb-1 font-bold text-[var(--edr-ink)]">Qué va a pasar</p>
              <p>
                El envío queda <strong>cancelado</strong> y deja de aparecer en el Panel del día.
                No nace ningún envío nuevo y el código no se reutiliza.
              </p>
              <p className="mt-1">
                El intento que ya hizo el repartidor <strong>no se borra</strong>: sigue en su día,
                con su motivo y su prueba, y sigue apareciendo en el resumen.
              </p>
              <p className="mt-1">Esto no se puede deshacer desde el panel.</p>
            </div>

            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)]">
              Por qué (queda escrito en el historial)
            </label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="El comercio nunca confirmó la nueva fecha."
              className="mb-3 w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]"
            />

            {error && <Aviso texto={error} />}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setError('');
                  setPantalla('reprogramar');
                }}
                className="rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-semibold hover:bg-[var(--edr-surface-2)]"
              >
                Volver
              </button>
              <button
                onClick={cancelar}
                disabled={guardando}
                className="rounded bg-[var(--edr-rojo)] px-4 py-2 text-sm font-black text-white hover:brightness-110 disabled:opacity-50"
              >
                {guardando ? 'Cancelando…' : 'No reprogramar · cancelar envío'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
