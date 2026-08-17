'use client';

/**
 * Elegir el comercio al cargar un envío, en vez de escribirlo todo de nuevo.
 *
 * Con 33 envíos de un mismo comercio, escribir la dirección de retiro a mano
 * cada vez son 33 oportunidades de que quede distinta — y así fue como el
 * historial terminó con TOY PIOLA y TOYPIOLA para el mismo lugar. Acá se
 * escribe "toy", se elige, y vienen la dirección, el piso y las notas.
 *
 * NO OBLIGA A ELEGIR. Los retiros eventuales —una terminal, la casa de alguien—
 * se siguen escribiendo a mano como siempre. La lista es para los fijos, que
 * son los que se repiten; forzar a dar de alta un comercio para cargar un envío
 * de una sola vez sería poner una traba en el camino del trabajo real.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Store, X } from 'lucide-react';

export interface Comercio {
  id: number;
  name: string;
  pickup_address: string | null;
  pickup_extra: string | null;
  pickup_notes: string | null;
}

/** Sin tildes y en minúscula, para que "guemes" encuentre "Güemes". */
const parecido = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export default function ElegirComercio({
  valor,
  onElegir,
  onLimpiar,
}: {
  /** El nombre escrito hoy en el formulario, venga de donde venga. */
  valor: string;
  onElegir: (c: Comercio) => void;
  /** Se llama al soltar el comercio: el envío vuelve a ser de carga manual. */
  onLimpiar: () => void;
}) {
  const [comercios, setComercios] = useState<Comercio[]>([]);
  const [elegido, setElegido] = useState<Comercio | null>(null);

  useEffect(() => {
    let vivo = true;

    supabase
      .from('clients')
      .select('id, name, pickup_address, pickup_extra, pickup_notes')
      .eq('active', true)
      .order('name')
      .then(({ data }) => {
        if (vivo) setComercios((data ?? []) as Comercio[]);
      });

    return () => {
      vivo = false;
    };
  }, []);

  /*
   * Los que coinciden con lo escrito. Se muestran sólo mientras se escribe algo
   * y todavía no se eligió: una lista de quince nombres colgando debajo del
   * campo, todo el tiempo, sería ruido en el formulario que más se usa.
   */
  const sugeridos = useMemo(() => {
    const q = parecido(valor.trim());
    if (!q || elegido) return [];
    return comercios.filter((c) => parecido(c.name).includes(q)).slice(0, 6);
  }, [comercios, valor, elegido]);

  if (elegido) {
    return (
      <div className="mt-1 flex items-start justify-between gap-2 rounded border border-[var(--edr-yellow)] bg-[var(--edr-surface)] px-3 py-2">
        <div className="min-w-0 text-xs">
          <span className="flex items-center gap-1.5 font-bold text-[var(--edr-acento)]">
            <Store size={13} />
            {elegido.name}
          </span>
          <span className="text-[var(--edr-muted)]">
            {elegido.pickup_address}
            {elegido.pickup_extra ? ` · ${elegido.pickup_extra}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setElegido(null);
            onLimpiar();
          }}
          title="Soltar el comercio y escribir la dirección a mano"
          className="shrink-0 rounded p-1 text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  if (sugeridos.length === 0) return null;

  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] p-1">
      {sugeridos.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => {
            setElegido(c);
            onElegir(c);
          }}
          className="rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--edr-surface-2)]"
        >
          <span className="font-bold">{c.name}</span>
          <span className="ml-1.5 text-[var(--edr-muted)]">
            {c.pickup_address}
            {c.pickup_extra ? ` · ${c.pickup_extra}` : ''}
          </span>
        </button>
      ))}
    </div>
  );
}
