'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, PackageSearch, ShieldCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { ETIQUETA_ESTADO, nombreDelDestinatario, type Shipment } from '@/lib/format';
import { estimarLlegada, type Estimacion } from '@/lib/eta';
import { HITOS, hastaDonde, respuestaParaElCliente } from '@/lib/admin/respuesta';
import { ES_CODIGO, colaDelTelefono, esTelefono, palabrasUtiles } from '@/lib/admin/busqueda';

/**
 * "¿Dónde está mi paquete?", contestado en un paso.
 *
 * Es la pregunta que más veces por día entra por WhatsApp, y hasta ahora se
 * contestaba a mano: buscar el código en la tabla, mirar el estado, calcular
 * cuánto falta y escribir la respuesta. Acá se pega lo que haya mandado el
 * comercio —el código, el teléfono, la dirección— y sale la contestación lista
 * para copiar.
 *
 * A diferencia del seguimiento público (`lib/trackServer.ts`), acá se consulta
 * con la sesión del admin: la posición del repartidor sale EXACTA, no
 * aproximada a la celda de 500 metros. Adentro se puede; lo que sale para
 * afuera es sólo el texto de la respuesta, que no lleva posición.
 */

interface Cierre {
  event: string;
  happened_at: string;
  failure_reason: string | null;
  receiver_name: string | null;
}

interface Hallazgo {
  envio: Shipment;
  eta: Estimacion | null;
  /** Minutos desde la última señal del repartidor. */
  senalHace: number | null;
  cierre: Cierre | null;
}

const COLUMNAS = '*, driver:assigned_driver(full_name)';

/**
 * Busca exigiendo que TODAS estas palabras aparezcan, cada una en la columna
 * que sea.
 *
 * Encadenar `or` los une con Y. ¡OJO! El `or` separa con comas y agrupa con
 * paréntesis: si esos signos llegaran adentro del texto partirían la consulta
 * al medio, y por eso las palabras vienen de `palabrasUtiles`, que ya los saca.
 */
async function porPalabras(palabras: string[]): Promise<Shipment[]> {
  let consulta = supabase.from('shipments').select(COLUMNAS);

  for (const p of palabras) {
    consulta = consulta.or(
      [
        `recipient_name.ilike.%${p}%`,
        `address_street.ilike.%${p}%`,
        `address_extra.ilike.%${p}%`,
        `client_name_raw.ilike.%${p}%`,
      ].join(','),
    );
  }

  const { data } = await consulta.order('id', { ascending: false }).limit(6);
  return (data ?? []) as unknown as Shipment[];
}

async function buscar(texto: string): Promise<Shipment[]> {
  const q = texto.trim();
  if (!q) return [];

  if (ES_CODIGO.test(q)) {
    const { data } = await supabase
      .from('shipments')
      .select(COLUMNAS)
      .ilike('tracking_code', `%${q}%`)
      .order('id', { ascending: false })
      .limit(6);
    return (data ?? []) as unknown as Shipment[];
  }

  if (esTelefono(q)) {
    const { data } = await supabase
      .from('shipments')
      .select(COLUMNAS)
      .ilike('recipient_phone', `%${colaDelTelefono(q)}%`)
      .order('id', { ascending: false })
      .limit(6);
    return (data ?? []) as unknown as Shipment[];
  }

  /*
   * Se afloja hasta encontrar algo.
   *
   * Pedir las tres palabras juntas es lo más preciso, pero alcanza con que una
   * sobre —"Brown 2055 fondo", cuando el "fondo" no quedó escrito en ningún
   * lado— para no encontrar nada. Y "no está" es la respuesta más cara que
   * puede dar este buscador: significa salir a buscarlo a mano en la tabla.
   * Así que si con tres no aparece, se prueba con dos, y después con una.
   */
  const palabras = palabrasUtiles(q);

  for (let cuantas = palabras.length; cuantas >= 1; cuantas--) {
    const encontrados = await porPalabras(palabras.slice(0, cuantas));
    if (encontrados.length) return encontrados;
  }

  return [];
}

/** Completa el envío con lo que hace falta para contestar: cierre y llegada. */
async function detallar(envio: Shipment): Promise<Hallazgo> {
  const { data: logs } = await supabase
    .from('delivery_logs')
    .select('event, happened_at, failure_reason, receiver_name')
    .eq('shipment_id', envio.id)
    .order('happened_at', { ascending: false });

  const movimientos = (logs ?? []) as unknown as Cierre[];
  const cierre =
    movimientos.find((l) => l.event === 'entregado' || l.event === 'no_entregado') ?? null;

  let eta: Estimacion | null = null;
  let senalHace: number | null = null;

  if (envio.status === 'en_camino' && envio.assigned_driver) {
    const { data: pos } = await supabase
      .from('driver_positions')
      .select('lat, lng, taken_at')
      .eq('driver_id', envio.assigned_driver)
      .order('taken_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pos) {
      const destino =
        envio.lat != null && envio.lng != null
          ? { lat: Number(envio.lat), lng: Number(envio.lng) }
          : null;
      eta = estimarLlegada(
        { lat: Number(pos.lat), lng: Number(pos.lng) },
        destino,
        pos.taken_at as string,
      );
      senalHace = Math.max(
        0,
        Math.round((Date.now() - new Date(pos.taken_at as string).getTime()) / 60_000),
      );
    }
  }

  return { envio, eta, senalHace, cierre };
}

export default function BuscarPaquete({ verPrueba }: { verPrueba: (s: Shipment) => void }) {
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [opciones, setOpciones] = useState<Shipment[]>([]);
  const [hallazgo, setHallazgo] = useState<Hallazgo | null>(null);
  const [aviso, setAviso] = useState('');
  const [copiado, setCopiado] = useState(false);
  /** La última búsqueda, para no repetirla. */
  const ultima = useRef({ q: '', cuando: 0 });

  async function elegir(envio: Shipment) {
    setOpciones([]);
    setHallazgo(await detallar(envio));
  }

  const correr = useCallback(async (q: string) => {
    if (!q.trim()) return;

    /*
     * La misma búsqueda dos veces seguidas se hace una sola.
     *
     * La barra de arriba manda el dato por dos caminos a la vez —la dirección
     * y el aviso— para que funcione se monte o no se monte la pantalla de
     * nuevo. Cuando funcionan los dos, esto evita la segunda consulta y el
     * parpadeo del "Buscando…".
     */
    const ahora = Date.now();
    if (ultima.current.q === q && ahora - ultima.current.cuando < 2000) return;
    ultima.current = { q, cuando: ahora };

    setTexto(q);
    setBuscando(true);
    setAviso('');
    setHallazgo(null);
    setOpciones([]);

    const encontrados = await buscar(q);
    setBuscando(false);

    if (!encontrados.length) {
      setAviso('No apareció ningún envío con eso. Probá con el código entero.');
      return;
    }
    // Uno solo se abre derecho: preguntar "¿es este?" cuando no hay otro es
    // un clic de más en lo que se usa cien veces por día.
    if (encontrados.length === 1) {
      setHallazgo(await detallar(encontrados[0]));
      return;
    }
    setOpciones(encontrados);
  }, []);

  /**
   * El buscador de la barra de arriba termina acá.
   *
   * Llegando de otra sección viene por la dirección (`?paquete=`); estando ya
   * en esta pantalla viene por aviso, porque navegar a la pantalla en la que
   * ya estás no la vuelve a montar y no pasaría nada.
   */
  useEffect(() => {
    const desdeArriba = (e: Event) => void correr((e as CustomEvent<string>).detail ?? '');
    window.addEventListener('edr-paquete', desdeArriba);

    const q = new URLSearchParams(window.location.search).get('paquete');
    if (q) {
      // La búsqueda arranca en el turno siguiente: llamarla acá derecho sería
      // cambiar el estado dentro del cuerpo del efecto.
      void Promise.resolve().then(() => correr(q));
      // Se limpia la dirección: si queda pegada, recargar vuelve a buscar algo
      // que capaz ya no es lo que se está mirando.
      window.history.replaceState(window.history.state, '', '/admin/panel');
    }

    return () => window.removeEventListener('edr-paquete', desdeArriba);
  }, [correr]);

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    void correr(texto);
  }

  async function copiar() {
    if (!hallazgo) return;
    const texto = respuestaParaElCliente(hallazgo);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      prompt('Copiá la respuesta:', texto);
    }
  }

  function limpiar() {
    setTexto('');
    setHallazgo(null);
    setOpciones([]);
    setAviso('');
  }

  return (
    <section className="flex flex-col gap-3.5 rounded-3xl border border-[var(--edr-hairline)] bg-[var(--edr-panel)] p-5">
      <div className="flex items-center gap-2.5">
        <PackageSearch size={19} strokeWidth={2.2} className="text-[var(--edr-yellow)]" />
        <h2 className="flex-1 font-anton text-lg uppercase tracking-[-.01em] text-white">
          Dónde está mi paquete
        </h2>
        {(hallazgo || opciones.length > 0) && (
          <button
            onClick={limpiar}
            aria-label="Empezar de nuevo"
            className="p-1 text-[#7f9de8] hover:text-white"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <form onSubmit={enviar}>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="EDR00001050MDQ · 223 555… · Falucho 1832"
          className="w-full rounded-full border border-white/20 bg-white/8 px-4 py-3 text-[14.5px] text-white outline-none placeholder:text-[#7f9de8] focus:border-[var(--edr-yellow)]"
        />
      </form>

      {buscando && <p className="text-[13px] text-[#b7cbff]">Buscando…</p>}
      {aviso && <p className="text-[13px] font-semibold text-[var(--edr-yellow)]">{aviso}</p>}

      {/* Varios candidatos: se elige cuál. */}
      {opciones.map((s) => (
        <button
          key={s.id}
          onClick={() => elegir(s)}
          className="rounded-2xl bg-white/8 px-4 py-3 text-left transition hover:bg-white/15"
        >
          <div className="edr-mono text-[13px] font-bold text-[var(--edr-yellow)]">
            {s.tracking_code}
          </div>
          <div className="text-[13.5px] text-white">{nombreDelDestinatario(s)}</div>
          <div className="text-xs text-[#b7cbff]">
            {s.address_street} · {ETIQUETA_ESTADO[s.status]}
          </div>
        </button>
      ))}

      {hallazgo && <Resultado h={hallazgo} copiar={copiar} copiado={copiado} verPrueba={verPrueba} />}
    </section>
  );
}

function Resultado({
  h,
  copiar,
  copiado,
  verPrueba,
}: {
  h: Hallazgo;
  copiar: () => void;
  copiado: boolean;
  verPrueba: (s: Shipment) => void;
}) {
  const { envio, eta, senalHace, cierre } = h;
  const llegado = hastaDonde(envio);
  const fallado = envio.status === 'pendiente_entrega';

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <div className="edr-mono text-[13px] font-bold text-[var(--edr-yellow)]">
          {envio.tracking_code}
        </div>
        <div className="font-anton text-xl uppercase leading-none tracking-[-.01em] text-white">
          {envio.address_street}
        </div>
        <div className="text-[13px] text-[#b7cbff]">
          {nombreDelDestinatario(envio)} · {envio.city}
          {envio.driver?.full_name ? ` · ${envio.driver.full_name}` : ''}
        </div>
      </div>

      {/* ---------- Los cinco hitos ---------- */}
      <div className="flex gap-1">
        {HITOS.map((hito, i) => {
          const hecho = i <= llegado;
          // El último tramo se pinta de rojo cuando el intento salió mal: la
          // línea llegó hasta la puerta, pero no terminó en entrega.
          const color = fallado && i === llegado ? 'var(--edr-rojo)' : 'var(--edr-yellow)';
          return (
            <div key={hito.evento} className="flex-1">
              <div
                className="h-1.5 rounded-full"
                style={{ background: hecho ? color : 'rgba(255,255,255,.18)' }}
              />
              <div
                className="mt-1.5 font-bebas text-[10.5px] tracking-[.05em]"
                style={{ color: hecho ? color : '#7f9de8' }}
              >
                {hito.nombre}
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- Cuánto falta ---------- */}
      {envio.status === 'en_camino' && (
        <div className="rounded-2xl border border-white/15 bg-white/8 px-4 py-3">
          <div className="font-bebas text-[13px] tracking-[.1em] text-[#b7cbff]">
            LLEGADA APROXIMADA
          </div>
          <div className="text-lg font-bold text-white">
            {eta ? eta.texto : 'No se puede calcular todavía'}
          </div>
          <div className="text-xs text-[#7f9de8]">
            {senalHace === null
              ? 'El repartidor no mandó su posición todavía'
              : `Última señal hace ${senalHace} min`}
            {!eta && envio.lat == null ? ' · el envío no tiene punto en el mapa' : ''}
          </div>
        </div>
      )}

      {fallado && cierre && (
        <div className="rounded-2xl border border-[var(--edr-rojo)] bg-[var(--edr-rojo)]/15 px-4 py-3 text-[13.5px] text-white">
          No se pudo entregar. Sigue esperando que se lo reprograme.
        </div>
      )}

      {/* ---------- La respuesta ya escrita ---------- */}
      <div className="whitespace-pre-line rounded-2xl bg-black/30 px-4 py-3 text-[13.5px] leading-relaxed text-white">
        {respuestaParaElCliente(h)}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={copiar}
          className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-[var(--edr-yellow)] px-4 font-bebas text-[15px] tracking-[.06em] text-[var(--edr-blue)] transition active:scale-95"
        >
          {copiado ? <Check size={16} strokeWidth={3} /> : <Copy size={16} strokeWidth={2.5} />}
          {copiado ? 'COPIADA' : 'COPIAR RESPUESTA'}
        </button>

        {cierre && (
          <button
            onClick={() => verPrueba(envio)}
            className="flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/25 px-4 font-bebas text-[15px] tracking-[.06em] text-white transition hover:bg-white/10"
          >
            <ShieldCheck size={16} strokeWidth={2.5} />
            PRUEBA
          </button>
        )}
      </div>
    </div>
  );
}
