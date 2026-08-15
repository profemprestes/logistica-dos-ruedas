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
 */
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

  async function guardar() {
    setGuardando(true);
    setError('');

    const { error: rpcError } = await supabase.rpc('reprogramar_envio', {
      p_shipment_id: shipment.id,
      p_fecha: fecha,
    });

    setGuardando(false);

    if (rpcError) {
      const m = rpcError.message;
      setError(
        m.includes('SOLO_ADMIN')
          ? 'Sólo un administrador puede reprogramar.'
          : m.includes('NO_ESTA_PARA_REPROGRAMAR')
            ? 'Sólo se reprograma un envío que quedó como no entregado.'
            : m.includes('FECHA_PASADA')
              ? 'Esa fecha ya pasó. Elegí hoy o un día que venga.'
              : m,
      );
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
            <h3 className="text-lg font-black">Reprogramar</h3>
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
            El envío nuevo se queda con <span className="edr-mono">{shipment.tracking_code}</span>:
            la etiqueta pegada en el paquete sigue escaneando bien, y el link que le pasaste al
            cliente le muestra este intento.
          </p>
          {shipment.assigned_driver && (
            <p className="mt-1">Queda con el mismo repartidor, que es quien tiene el paquete.</p>
          )}
        </div>

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
            disabled={guardando || !fecha}
            className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
          >
            {guardando ? 'Reprogramando…' : 'Reprogramar'}
          </button>
        </div>
      </div>
    </div>
  );
}
