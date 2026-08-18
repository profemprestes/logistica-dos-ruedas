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
import {
  comoHora,
  estadoDelComercio,
  faltaTexto,
  horarioDeRetiro,
  minutosParaElCierre,
  textoFranja,
} from '@/lib/franja';

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

  /*
   * DOS RELOJES, y para cada envío gana el que corre primero.
   *
   * Uno es la franja de entrega: hasta cuándo hay para llegar. El otro es el
   * horario del comercio: hasta cuándo hay para retirar, que para un paquete
   * que todavía está en el mostrador puede vencerse mucho antes. Un envío con
   * entrega "antes de 19" que se retira en un local que cierra 18 es urgente a
   * las 17:30, no a las 18:30.
   *
   * El de retiro sólo cuenta mientras el paquete siga en el comercio: una vez
   * que lo tiene encima, ese reloj ya no existe.
   */
  const urgentes = envios
    .filter((s) => s.status !== 'entregado' && s.status !== 'cancelado')
    .map((s) => {
      const enElComercio = s.status === 'creado' || s.status === 'pendiente_retiro';
      const entrega = minutosParaElCierre(s.delivery_window, hora);

      const texto = enElComercio
        ? horarioDeRetiro(s as Shipment & { comercio?: { pickup_window?: string | null } })
        : null;

      const local = texto ? estadoDelComercio(texto, hora) : null;

      /*
       * Del comercio sólo apura lo que se cierra AHORA.
       *
       * Si está en la siesta y vuelve a abrir a las 15:30, no hay nada que
       * correr: el paquete sale igual a la tarde. Lo urgente es el rato que se
       * está terminando, o que ya cerró por hoy.
       */
      const faltaRetiro = local
        ? local.abierto
          ? local.cierraEnMin
          : local.abreA !== null
            ? null
            : -1
        : null;

      // El más apurado de los dos es el que manda lo que hay que hacer ahora.
      const porRetiro = faltaRetiro !== null && (entrega === null || faltaRetiro < entrega);

      const falta = porRetiro ? faltaRetiro : entrega;
      return {
        s,
        falta,
        porRetiro,
        cuando: porRetiro ? texto : s.delivery_window,
        vuelveAAbrir: local?.abierto ? local.vuelveAAbrir : null,
      };
    })
    .filter(
      (
        x,
      ): x is {
        s: Shipment;
        falta: number;
        porRetiro: boolean;
        cuando: string | null;
        vuelveAAbrir: number | null;
      } => x.falta !== null,
    )
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

        {urgentes.map(({ s, falta, porRetiro, cuando, vuelveAAbrir }) => {
          const enElComercio = s.status === 'creado' || s.status === 'pendiente_retiro';

          return (
            <div key={s.id} className="rounded-2xl bg-black/25 px-3 py-2.5">
              <div className="font-bebas text-[13px] tracking-[.08em] text-white/80">
                {/* Qué hay que hacer, no en qué estado está: al que sigue en el
                    mostrador le falta un viaje más, y si lo que se vence es el
                    horario del local, lo urgente es pasar a buscarlo. */}
                {porRetiro
                  ? falta < 0
                    ? 'EL COMERCIO YA CERRÓ'
                    : `PASÁ A RETIRAR · CIERRA ${faltaTexto(falta).toUpperCase()}`
                  : `${enElComercio ? 'RETIRAR Y ENTREGAR' : 'ENTREGAR'} · ${faltaTexto(falta).toUpperCase()}`}
              </div>

              <div className="font-anton text-[19px] uppercase leading-tight tracking-[-.02em] text-white">
                {porRetiro ? (s.pickup_address ?? s.address_street) : s.address_street}
              </div>

              <div className="text-[13px] font-semibold text-white/85">
                {textoFranja(cuando)}
                {porRetiro && vuelveAAbrir !== null ? ` · vuelve a abrir ${comoHora(vuelveAAbrir)}` : ''}
                {porRetiro && s.address_street ? ` · después va a ${s.address_street}` : ''}
                {!porRetiro && enElComercio && s.pickup_address
                  ? ` · retirás en ${s.pickup_address}`
                  : ''}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
