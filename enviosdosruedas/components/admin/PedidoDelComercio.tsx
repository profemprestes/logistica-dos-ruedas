'use client';

import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import {
  NOMBRE_CAMPO,
  aprobar,
  loQueCambia,
  rechazar,
  type Solicitud,
} from '@/lib/comercio/solicitudes';
import type { Comercio } from '@/components/admin/EditarComercio';

/**
 * El pedido de cambio de datos que un comercio dejó esperando.
 *
 * MUESTRA SÓLO LO QUE CAMBIA. El comercio manda el formulario entero, así que
 * casi siempre viene todo repetido menos una cosa. Listar los cinco campos
 * obligaría a comparar de memoria cuál se movió; mostrar el de antes y el de
 * ahora, uno al lado del otro, es la pregunta que hay que contestar para
 * aprobar.
 *
 * Si no pide nada distinto de lo que ya está, se dice: es un pedido que se
 * puede cerrar sin pensarlo.
 */
export default function PedidoDelComercio({
  comercio,
  onResuelto,
}: {
  comercio: Comercio;
  onResuelto: () => void;
}) {
  const [pedido, setPedido] = useState<Solicitud | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    let vivo = true;

    const traer = async () => {
      const { data } = await supabase
        .from('solicitudes_comercio')
        .select('*')
        .eq('client_id', comercio.id)
        .eq('estado', 'pendiente')
        .maybeSingle();

      if (vivo) setPedido((data as Solicitud) ?? null);
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [comercio.id]);

  if (!pedido) return null;

  const cambios = loQueCambia(pedido, comercio);

  async function resolver(que: 'aprobar' | 'rechazar') {
    if (!pedido) return;
    setTrabajando(true);
    setError('');

    const e =
      que === 'aprobar' ? await aprobar(pedido.id) : await rechazar(pedido.id, motivo);

    setTrabajando(false);
    if (e) return setError(e);

    setPedido(null);
    onResuelto();
  }

  return (
    <section className="mb-4 rounded-lg border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-4">
      <h3 className="font-black text-[var(--edr-acento)]">
        {comercio.name} pidió cambiar sus datos
      </h3>
      <p className="mt-0.5 text-xs text-[var(--edr-muted)]">
        Lo pidió el{' '}
        {new Date(pedido.creada_at).toLocaleDateString('es-AR', {
          day: '2-digit',
          month: '2-digit',
        })}
        . No se aplicó nada todavía.
      </p>

      {pedido.nota && <p className="mt-2 text-sm">“{pedido.nota}”</p>}

      {cambios.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--edr-muted)]">
          No pide nada distinto de lo que ya está cargado. Se puede cerrar sin más.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {cambios.map((c) => (
            <li
              key={c.campo}
              className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-3 py-2 text-sm"
            >
              <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
                {NOMBRE_CAMPO[c.campo]}
              </div>
              <div className="text-[var(--edr-muted)] line-through">{c.antes}</div>
              <div className="font-bold">{c.ahora}</div>
            </li>
          ))}
        </ul>
      )}

      {/* Que la dirección se lleve el punto no es un detalle: si no se avisa,
          el comercio queda "sin ubicar" y nadie entiende por qué. */}
      {cambios.some((c) => c.campo === 'pickup_address') && (
        <p className="mt-2 text-xs text-[var(--edr-naranja-claro)]">
          Al aprobarlo, el punto del mapa se borra y hay que verificarlo de nuevo en la ficha: la
          dirección nueva no cae donde caía la vieja.
        </p>
      )}

      {error && (
        <div className="mt-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {rechazando ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="¿Por qué no? El comercio lo va a leer"
            className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]"
          />
          <div className="flex gap-2">
            <button
              onClick={() => resolver('rechazar')}
              disabled={trabajando}
              className="rounded border border-[var(--edr-rojo)] px-3 py-2 text-sm font-bold text-[var(--edr-rojo-claro)] disabled:opacity-50"
            >
              {trabajando ? 'Guardando…' : 'Confirmar el rechazo'}
            </button>
            <button
              onClick={() => setRechazando(false)}
              className="rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-bold text-[var(--edr-muted)]"
            >
              Volver
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => resolver('aprobar')}
            disabled={trabajando}
            className="inline-flex items-center gap-1.5 rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] disabled:opacity-50"
          >
            <Check size={16} /> {trabajando ? 'Aplicando…' : 'Aprobar y aplicar'}
          </button>
          <button
            onClick={() => setRechazando(true)}
            disabled={trabajando}
            className="inline-flex items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-2 text-sm font-bold text-[var(--edr-muted)] disabled:opacity-50"
          >
            <X size={16} /> No aplicarlo
          </button>
        </div>
      )}
    </section>
  );
}
