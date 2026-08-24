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
import { Clock, Navigation, PackageCheck, Store } from 'lucide-react';
import { useToast } from '@/components/driver/Toast';
import {
  comoLlegar,
  marcarHecha,
  misColectas,
  paquetesDeLaColecta,
  type Colecta,
  type Paquete,
} from '@/lib/driver/colectas';
import { hoyLocal } from '@/lib/scheduled';
import { horaDelDiaAR } from '@/lib/format';
import {
  comoEstaElComercio,
  estadoDelComercio,
  horarioDeRetiro,
  textoFranja,
} from '@/lib/franja';

/**
 * Si la nota es el conteo que escribe el sistema solo ("4 paquetes") y no algo
 * que escribió una persona ("pasar después de las 14").
 *
 * A propósito es exacta: cualquier cosa de más que el número y la palabra la
 * deja pasar. Equivocarse para este lado sólo repite un número; para el otro le
 * borraría al repartidor una indicación que alguien se tomó el trabajo de
 * escribirle.
 */
function esConteoAutomatico(nota: string): boolean {
  return /^\d+\s+paquetes?$/i.test(nota.trim());
}

export default function Colectas() {
  const toast = useToast();
  const [colectas, setColectas] = useState<Colecta[]>([]);
  const [ocupada, setOcupada] = useState<number | null>(null);

  /**
   * Qué paquetes hay en cada comercio, por dirección.
   *
   * Se piden junto con las colectas y no al tocar: el repartidor mira esto
   * mientras maneja o antes de arrancar, y un toque de más para saber si vale
   * la pena ir es un toque que no va a dar.
   */
  const [paquetes, setPaquetes] = useState<Map<string, Paquete[]>>(new Map());

  const traer = useCallback(() => {
    void misColectas().then(async (cs) => {
      setColectas(cs);

      const mapa = new Map<string, Paquete[]>();
      await Promise.all(
        cs.map(async (c) => {
          mapa.set(c.direccion, await paquetesDeLaColecta(c.direccion));
        }),
      );
      setPaquetes(mapa);
    });
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

  /*
   * La hora se saca acá y no con un reloj propio: esta pantalla ya se redibuja
   * sola cada minuto para buscar colectas nuevas (el `setInterval` de arriba),
   * así que el "cierra en 20 min" se actualiza con ella. Un segundo reloj para
   * lo mismo sería despertarla el doble para nada.
   */
  const ahora = new Date();
  const hora = horaDelDiaAR(ahora);

  return (
    <section className="flex flex-col gap-2.5 px-3.5 pt-4">
      <h2 className="font-anton text-[22px] uppercase leading-none tracking-[-.02em] text-white">
        Pasá a retirar
      </h2>

      {colectas.map((c) => (
        <ColectaCard
          key={c.id}
          c={c}
          paquetes={paquetes.get(c.direccion) ?? []}
          hoy={hoy}
          ahora={ahora}
          hora={hora}
          ocupada={ocupada === c.id}
          onHecha={() => hecha(c)}
        />
      ))}
    </section>
  );
}

/**
 * Una colecta, dibujada.
 *
 * VIVE APARTE de la lista porque son dos trabajos distintos: la lista pide
 * datos y se refresca sola, la tarjeta sólo muestra lo que le dan. Separadas
 * se puede mirar la tarjeta sin sesión y sin base —que es la única forma de
 * revisar cómo se ve antes de publicarla, porque adentro de la app hay que
 * estar logueado.
 */
export function ColectaCard({
  c,
  paquetes,
  hoy,
  ahora,
  hora,
  ocupada,
  onHecha,
}: {
  c: Colecta;
  /** Los que lo esperan en ese comercio. Vacío si no hay o no se pudieron leer. */
  paquetes: Paquete[];
  hoy: string;
  /** El momento, para saber si es sábado. */
  ahora: Date;
  /** La hora del día en Mar del Plata, 13.5 son las 13:30. */
  hora: number;
  ocupada: boolean;
  onHecha: () => void;
}) {
  /*
   * El horario del local al que lo mandan.
   *
   * Se arma con la misma función que la hoja de ruta —`horarioDeRetiro`— para
   * que el sábado valga el horario del sábado también acá. Una colecta no
   * tiene "excepción del envío": todavía no hay envío.
   */
  const horario = horarioDeRetiro(
    { comercio: { pickup_window: c.horario, pickup_window_sabado: c.horarioSabado } },
    ahora,
  );
  const estado = horario ? estadoDelComercio(horario, hora) : null;

  return (
    <article
      /* Ámbar lleno, no azul: esto va ANTES de repartir, y entre las
         tarjetas azules de la hoja de ruta tiene que despegarse sola. El
         texto va en azul oscuro porque sobre este amarillo el blanco no se
         lee al sol. */
      className="flex flex-col gap-3 rounded-3xl bg-[var(--edr-ambar)] p-4 text-[var(--edr-blue-dark)] shadow-[var(--edr-sombra)]"
    >
      <div className="flex flex-col gap-1">
        {c.comercio && (
          <span className="flex items-center gap-1.5 font-bebas text-[15px] tracking-[.08em]">
            <Store size={15} strokeWidth={2} />
            {c.comercio}
          </span>
        )}

        <span className="font-anton text-[26px] uppercase leading-[.98] tracking-[-.02em]">
          {c.direccion}
        </span>

        {/* El horario del comercio, igual que en la hoja de ruta: acá
            también se decide si ir ahora o después. Sin colorear el
            estado —la tarjeta entera ya es el aviso— y en negrita, que
            sobre el ámbar se lee mejor que cualquier color. */}
        {horario && (
          <span className="flex items-start gap-1.5 text-[13px] font-medium leading-snug">
            <Clock size={14} strokeWidth={2.5} className="mt-[3px] shrink-0" />
            <span>
              {textoFranja(horario)}
              {estado && <span className="font-bold"> · {comoEstaElComercio(estado).texto}</span>}
            </span>
          </span>
        )}

        {/* La nota, salvo el "N paquetes" que se escribe solo al preasignar
            cuando abajo ya está la lista de verdad.

            Ese número queda congelado del momento en que se creó la
            colecta: si uno de los cuatro se escaneó, la nota sigue diciendo
            cuatro y la lista muestra tres. Dos números distintos para lo
            mismo en la misma tarjeta, y el repartidor buscando un paquete
            que no está. Lo que él escribe a mano no se toca nunca. */}
        {c.nota && !(esConteoAutomatico(c.nota) && (paquetes.length) > 0) && (
          <span className="text-[15px] font-semibold">{c.nota}</span>
        )}

        {/* La fecha sólo si no es de hoy. Una colecta de ayer sin hacer
            sigue siendo un comercio con paquetes esperando, y esconderla
            sería hacer desaparecer el problema en vez de resolverlo. */}
        {/* Rojo LLENO y no letra roja: sobre el ámbar, el rojo de texto queda
            en 2,25 a 1 y de reojo no se ve. Relleno con letra blanca se lee, y
            además es lo único de la tarjeta que dice que algo se atrasó. */}
        {c.fecha !== hoy && (
          <span className="mt-0.5 w-fit rounded-full bg-[var(--edr-rojo)] px-2.5 py-1 font-bebas text-sm leading-none tracking-[.06em] text-white">
            QUEDÓ DEL {c.fecha.split('-').reverse().slice(0, 2).join('/')}
          </span>
        )}
      </div>

      {/* Los paquetes que lo esperan ahí. Sólo la dirección de entrega: no
          son suyos hasta que los escanee, y darle destinatario y plata de
          envíos que capaz lleva otro sería prometerle algo que no es.

          SÓLO LOS PREASIGNADOS A ÉL. Los que no tienen dueño no se listan,
          y no es por prudencia: un paquete sin preasignar es uno que en la
          oficina todavía no se repartió. El local puede tenerlo listo y
          pasarlo en el momento, y ahí se consulta y se asigna a quien
          corresponde. Mostrárselo lo invita a llevárselo antes de que eso
          pase — y el escáner no lo frenaría, porque un envío sin dueño lo
          toma cualquiera. Lo libre queda libre. */}
      {(paquetes.length) > 0 && (
        <div className="rounded-2xl bg-black/10 px-3 py-2.5">
          <div className="font-bebas text-sm tracking-[.06em] opacity-70">
            LO QUE TENÉS QUE RETIRAR
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {paquetes.map((p, i) => (
              <li key={`${p.destino}-${i}`} className="text-[15px] font-semibold">
                {p.destino}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onHecha}
          disabled={ocupada}
          style={{ background: 'var(--edr-verde)' }}
          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full px-4 font-bebas text-xl tracking-[.06em] text-white transition active:scale-95 disabled:opacity-60"
        >
          <PackageCheck size={19} strokeWidth={2.5} />
          {ocupada ? 'ESPERÁ…' : 'YA RETIRÉ'}
        </button>

        <a
          href={comoLlegar(c)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Cómo llegar"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[var(--edr-blue-dark)]/30 bg-[var(--edr-blue-dark)]/10 transition active:scale-95"
        >
          <Navigation size={20} strokeWidth={2} />
        </a>
      </div>
    </article>
  );
}
