'use client';

/**
 * Lo que se le está por vencer, y nada más.
 *
 * NO ES UNA LISTA MÁS. La hoja de ruta ya muestra todo lo que tiene que hacer;
 * esto muestra sólo lo que se vence en menos de una hora, que es una pregunta
 * distinta: no "qué me queda" sino "qué tengo que hacer AHORA".
 *
 * Y POR ESO NO DIBUJA NADA CUANDO NO HAY NADA. Un cartel que está siempre en
 * pantalla deja de leerse a la semana: el repartidor lo aprende como parte del
 * fondo. Éste aparece cuando hay algo y desaparece cuando se resuelve, así que
 * verlo significa algo.
 *
 * Sólo mira los envíos que tienen franja escrita. Sin franja no hay nada que
 * vencer, y adivinar una hora límite sería apurarlo por algo que nadie
 * prometió.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { horaDelDiaAR, type Shipment } from '@/lib/format';
import { faltaTexto, minutosParaElCierre, textoFranja } from '@/lib/franja';

/** Menos de esto es "salí ya". Es el mismo número que usa la oficina. */
const MINUTOS_DE_ALERTA = 60;

export default function Apurate({ envios }: { envios: Shipment[] }) {
  /*
   * La hora se guarda en estado y se refresca sola cada minuto.
   *
   * Sin esto, el aviso se calcularía una sola vez al abrir la pantalla y se
   * quedaría congelado: el repartidor deja la app abierta media hora y el
   * cartel seguiría diciendo "en 40 min" cuando faltan diez.
   */
  const [hora, setHora] = useState<number | null>(null);

  useEffect(() => {
    const mirar = () => setHora(horaDelDiaAR(new Date()));
    mirar();
    const t = window.setInterval(mirar, 60_000);
    return () => window.clearInterval(t);
  }, []);

  if (hora === null) return null;

  const urgentes = envios
    .filter((s) => s.status !== 'entregado' && s.status !== 'cancelado')
    .map((s) => ({ s, falta: minutosParaElCierre(s.delivery_window, hora) }))
    .filter((x): x is { s: Shipment; falta: number } => x.falta !== null)
    .filter((x) => x.falta < MINUTOS_DE_ALERTA)
    // El que menos tiempo tiene, primero. Si ya se pasaron dos, primero el que
    // se pasó hace más: ése es el que hay que ir a resolver o avisar.
    .sort((a, b) => a.falta - b.falta);

  if (urgentes.length === 0) return null;

  return (
    <section className="px-3.5 pt-4">
      <div
        className="flex flex-col gap-2 rounded-3xl p-4"
        style={{ background: 'var(--edr-rojo)' }}
      >
        <div className="flex items-center gap-2 font-anton text-[20px] uppercase leading-none tracking-[-.02em] text-white">
          <AlertTriangle size={19} strokeWidth={2.5} />
          {urgentes.length === 1 ? 'Se te vence uno' : `Se te vencen ${urgentes.length}`}
        </div>

        {urgentes.map(({ s, falta }) => {
          // Retirar y entregar no es lo mismo que sólo llegar: al que todavía
          // está en el comercio le falta un viaje más, y eso cambia si sale ya
          // o si puede terminar lo que está haciendo.
          const enElComercio = s.status === 'creado' || s.status === 'pendiente_retiro';

          return (
            <div key={s.id} className="rounded-2xl bg-black/25 px-3 py-2.5">
              <div className="font-bebas text-[13px] tracking-[.08em] text-white/80">
                {enElComercio ? 'RETIRAR Y ENTREGAR' : 'ENTREGAR'} ·{' '}
                {(falta < 0 ? faltaTexto(falta) : `cierra ${faltaTexto(falta)}`).toUpperCase()}
              </div>

              <div className="font-anton text-[19px] uppercase leading-tight tracking-[-.02em] text-white">
                {s.address_street}
              </div>

              <div className="text-[13px] font-semibold text-white/85">
                {textoFranja(s.delivery_window)}
                {enElComercio && s.pickup_address ? ` · retirás en ${s.pickup_address}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
