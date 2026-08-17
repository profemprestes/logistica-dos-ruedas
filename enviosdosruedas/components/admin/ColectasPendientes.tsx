'use client';

/**
 * Las colectas mandadas que todavía nadie retiró, con su botón de cancelar.
 *
 * VIVE EN DOS LADOS A PROPÓSITO. En el Panel del día, porque es estado del día
 * como cualquier otro y ahí es donde se mira cómo viene la jornada. Y adentro
 * del cuadro de "Mandar a retirar", porque antes de mandar a alguien conviene
 * ver si ya hay una para ese comercio.
 *
 * La primera versión estuvo sólo en el cuadro y no servía: para ver una colecta
 * había que abrir la pantalla de crear otra, que es como buscar la lista de
 * llamadas adentro del teclado del teléfono.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { hoyLocal } from '@/lib/scheduled';

export interface ColectaPendiente {
  id: number;
  direccion: string;
  comercio: string | null;
  nota: string | null;
  fecha: string;
  repartidor: { full_name: string } | null;
}

export default function ColectasPendientes({
  onAviso,
  vacio,
}: {
  /** Qué decir cuando se canceló una. */
  onAviso?: (texto: string) => void;
  /** Qué dibujar cuando no hay ninguna. Sin esto no dibuja nada. */
  vacio?: React.ReactNode;
}) {
  const [colectas, setColectas] = useState<ColectaPendiente[]>([]);
  const [cancelando, setCancelando] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vivo = true;

    async function traer() {
      const { data } = await supabase
        .from('colectas')
        .select('id, direccion, comercio, nota, fecha, repartidor:driver_id(full_name)')
        .is('hecha_at', null)
        .order('fecha', { ascending: true })
        .limit(20);

      if (vivo) setColectas((data ?? []) as unknown as ColectaPendiente[]);
    }

    void traer();
    return () => {
      vivo = false;
    };
  }, [version]);

  /**
   * Cancelar una colecta la borra.
   *
   * Se borra en vez de marcarse: una colecta es una instrucción, no un hecho.
   * "Andá a buscar a Independencia" que se cancela no dejó nada atrás que valga
   * la pena guardar, y una lista llena de instrucciones tachadas se deja de
   * leer.
   *
   * En el celular del repartidor desaparece sola dentro del minuto: esa
   * pantalla se refresca sin que él toque nada.
   */
  const cancelar = useCallback(
    async (c: ColectaPendiente) => {
      const quien = c.repartidor?.full_name ?? 'el repartidor';
      if (!confirm(`¿Cancelar la colecta de ${c.comercio || c.direccion} para ${quien}?`)) return;

      setCancelando(c.id);
      const { error: e } = await supabase.from('colectas').delete().eq('id', c.id);
      setCancelando(null);

      if (e) {
        setError(e.message);
        return;
      }

      setVersion((v) => v + 1);
      onAviso?.(`Se canceló la colecta de ${c.comercio || c.direccion} para ${quien}.`);
    },
    [onAviso],
  );

  if (colectas.length === 0) return <>{vacio ?? null}</>;

  const hoy = hoyLocal();

  return (
    <div className="flex flex-col gap-1.5">
      {error && (
        <div className="rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {colectas.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-2 rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">
              {c.comercio ? `${c.comercio} · ` : ''}
              {c.direccion}
            </div>
            <div className="truncate text-xs text-[var(--edr-muted)]">
              {c.repartidor?.full_name ?? 'sin repartidor'}
              {c.nota ? ` · ${c.nota}` : ''}
              {/* Una de otro día sigue siendo un comercio con paquetes
                  esperando. Que se note cuál es. */}
              {c.fecha !== hoy
                ? ` · quedó del ${c.fecha.split('-').reverse().slice(0, 2).join('/')}`
                : ''}
            </div>
          </div>

          <button
            onClick={() => cancelar(c)}
            disabled={cancelando === c.id}
            className="shrink-0 rounded-full border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold text-[var(--edr-muted)] disabled:opacity-50"
          >
            {cancelando === c.id ? 'Esperá…' : 'Cancelar'}
          </button>
        </div>
      ))}
    </div>
  );
}
