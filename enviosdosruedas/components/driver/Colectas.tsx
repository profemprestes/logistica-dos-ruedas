'use client';

/**
 * Lo primero que ve el repartidor: a dónde tiene que ir a retirar.
 *
 * Va arriba de la hoja de ruta y no en una pantalla aparte, porque el retiro
 * pasa ANTES que el reparto: si estuviera escondido en otra sección habría que
 * acordarse de mirarla, y acordarse es justamente lo que hoy resuelve el
 * WhatsApp.
 *
 * Cuando no hay ninguna no dibuja nada. Un cartel de "no tenés colectas" en la
 * pantalla que se abre veinte veces por día es ruido.
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigation, PackageCheck, Store } from 'lucide-react';
import { useToast } from '@/components/driver/Toast';
import { comoLlegar, marcarHecha, misColectas, type Colecta } from '@/lib/driver/colectas';
import { hoyLocal } from '@/lib/scheduled';

export default function Colectas() {
  const toast = useToast();
  const [colectas, setColectas] = useState<Colecta[]>([]);
  const [ocupada, setOcupada] = useState<number | null>(null);

  const traer = useCallback(() => {
    void misColectas().then(setColectas);
  }, []);

  useEffect(() => {
    traer();
    // Se refresca sola: la oficina puede mandar una colecta mientras el
    // repartidor tiene la app abierta, y esperar a que la cierre y la abra
    // sería volver al WhatsApp para avisarle que mire la app.
    const timer = window.setInterval(traer, 60_000);
    return () => window.clearInterval(timer);
  }, [traer]);

  const hecha = useCallback(
    async (c: Colecta) => {
      setOcupada(c.id);
      const ok = await marcarHecha(c.id);
      setOcupada(null);

      if (!ok) {
        toast('No se pudo marcar. Fijate si tenés señal.', 'error');
        return;
      }

      // Se saca de la lista sin volver a preguntarle al servidor: ya contestó
      // que sí, y esperar el viaje de vuelta deja el botón "pensando".
      setColectas((prev) => prev.filter((x) => x.id !== c.id));
      toast('Listo, colecta hecha.', 'ok');
    },
    [toast],
  );

  if (colectas.length === 0) return null;

  const hoy = hoyLocal();

  return (
    <section className="flex flex-col gap-2.5 px-3.5 pt-4">
      <h2 className="font-anton text-[22px] uppercase leading-none tracking-[-.02em] text-white">
        Pasá a retirar
      </h2>

      {colectas.map((c) => (
        <article
          key={c.id}
          className="flex flex-col gap-3 rounded-3xl border border-[var(--edr-yellow)]/40 bg-[var(--edr-blue)] p-4"
        >
          <div className="flex flex-col gap-1">
            {c.comercio && (
              <span className="flex items-center gap-1.5 font-bebas text-[15px] tracking-[.08em] text-[var(--edr-yellow)]">
                <Store size={15} strokeWidth={2} />
                {c.comercio}
              </span>
            )}

            <span className="font-anton text-[26px] uppercase leading-[.98] tracking-[-.02em] text-white">
              {c.direccion}
            </span>

            {c.nota && <span className="text-[15px] font-semibold text-white">{c.nota}</span>}

            {/* La fecha sólo si no es de hoy. Una colecta de ayer sin hacer
                sigue siendo un comercio con paquetes esperando, y esconderla
                sería hacer desaparecer el problema en vez de resolverlo. */}
            {c.fecha !== hoy && (
              <span className="font-bebas text-sm tracking-[.06em] text-[var(--edr-naranja-claro)]">
                QUEDÓ DEL {c.fecha.split('-').reverse().slice(0, 2).join('/')}
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => hecha(c)}
              disabled={ocupada === c.id}
              style={{ background: 'var(--edr-verde)' }}
              className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full px-4 font-bebas text-xl tracking-[.06em] text-white transition active:scale-95 disabled:opacity-60"
            >
              <PackageCheck size={19} strokeWidth={2.5} />
              {ocupada === c.id ? 'ESPERÁ…' : 'YA RETIRÉ'}
            </button>

            <a
              href={comoLlegar(c)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Cómo llegar"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/[.06] text-white transition active:scale-95"
            >
              <Navigation size={20} strokeWidth={2} />
            </a>
          </div>
        </article>
      ))}
    </section>
  );
}
