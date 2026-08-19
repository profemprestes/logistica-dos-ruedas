'use client';

import { useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, FileText, Pencil, RefreshCw, Search } from 'lucide-react';
import ProofOfDeliveryModal from '@/components/ProofOfDeliveryModal';
import { supabase } from '@/lib/supabaseClient';
import {
  ETIQUETA_ESTADO,
  PAYMENT_LABEL,
  STATUS_CLASS,
  diaAR,
  hoyAR,
  money,
  nombreDelDestinatario,
  type Shipment,
} from '@/lib/format';
import { cuandoSeHace } from '@/lib/scheduled';
import { trackUrl } from '@/lib/trackUrl';
import {
  NOMBRE_GRUPO,
  NOMBRE_PERIODO,
  ORDEN_GRUPOS,
  ORDEN_PERIODOS,
  VACIO_GRUPO,
  coincide,
  entraEnElPeriodo,
  estaCerrado,
  grupoDe,
  ordenar,
  rangoDelPeriodo,
  type Grupo,
  type Periodo,
} from '@/lib/comercio/estados';

/**
 * Los envíos de UN comercio, como los ve él.
 *
 * La misma pantalla la abre el comercio con su usuario y la abre la oficina
 * desde la ficha del comercio. Es a propósito: cuando el comercio llama
 * preguntando por un envío, quien atiende tiene que estar mirando exactamente
 * lo que él está mirando. Dos pantallas parecidas pero distintas terminan en
 * "a mí no me figura así".
 *
 * ES DE LECTURA. No hay nada acá que cambie un envío. Los permisos del paso 49
 * tampoco lo dejarían, pero la pantalla no tiene ni el botón: que la base te
 * frene una acción que la pantalla ofrece es una forma de mentirle al que la
 * usa.
 */

/** Lo poco que hace falta saber del comercio para dibujar esto. */
export interface FichaComercio {
  id: number;
  name: string;
  pickup_address?: string | null;
  pickup_extra?: string | null;
  pickup_notes?: string | null;
  pickup_window?: string | null;
  pickup_window_sabado?: string | null;
  phone?: string | null;
}

/**
 * Cuántos envíos se traen de una.
 *
 * Es holgado: el comercio más grande que hay hoy tiene 33. Si algún día alguno
 * pasa de esto, abajo aparece el aviso de cuántos quedaron afuera — que es
 * mejor que mostrar 500 sin decir nada y que el comercio crea que ésos son
 * todos los que tiene.
 */
const TOPE = 500;

const chipBase =
  'rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ring-1 ring-inset';

export default function ResumenDelComercio({
  comercio,
  sucursales = [],
  desdeLaOficina = false,
}: {
  comercio: FichaComercio;
  /**
   * Los otros locales del mismo comercio, si tiene.
   *
   * Sus envíos entran en la misma lista: para el que mandó el paquete es un
   * solo negocio, aunque salga de dos locales distintos. Cuando hay más de
   * uno, cada envío dice de cuál salió — si no, la lista sería dos listas
   * mezcladas sin forma de distinguirlas.
   */
  sucursales?: FichaComercio[];
  /**
   * Lo está mirando el admin y no el comercio.
   *
   * Lo único que cambia es que aparece el link para abrir el envío en el
   * panel, donde sí se puede editar, reasignar y borrar. La lista, los
   * casilleros y los comprobantes son exactamente los mismos: si fueran
   * distintos, la oficina y el comercio no podrían hablar del mismo envío.
   */
  desdeLaOficina?: boolean;
}) {
  const [envios, setEnvios] = useState<Shipment[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  const [grupo, setGrupo] = useState<Grupo | 'todos'>('en_curso');
  const [busqueda, setBusqueda] = useState('');
  /*
   * Qué días mirar.
   *
   * Arranca en "todos" y no en "hoy" a propósito: lo primero que busca un
   * comercio al entrar es si le falta algo, y eso puede ser de ayer. El día se
   * elige cuando se pregunta por un día.
   */
  const [periodo, setPeriodo] = useState<Periodo>('todo');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [comprobante, setComprobante] = useState<Shipment | null>(null);
  const [copiado, setCopiado] = useState('');

  /** El comercio y sus locales, que para esta pantalla son uno solo. */
  const ids = useMemo(
    () => [comercio.id, ...sucursales.map((s) => s.id)],
    [comercio.id, sucursales],
  );

  /** De qué local salió cada envío. Vacío cuando hay un solo local. */
  const nombreDeLocal = useMemo(() => {
    if (sucursales.length === 0) return new Map<number, string>();
    return new Map<number, string>([
      [comercio.id, comercio.name],
      ...sucursales.map((s) => [s.id, s.name] as [number, string]),
    ]);
  }, [comercio, sucursales]);

  useEffect(() => {
    let vivo = true;

    const traer = async () => {
      setCargando(true);

      /*
       * El `client_id` va escrito aunque los permisos ya filtren solos. No es
       * desconfianza de los permisos: es que esta misma consulta la corre el
       * admin desde la ficha del comercio, y él SÍ ve todos los envíos. Sin el
       * filtro, la oficina vería la base entera en la pantalla de un comercio.
       */
      const {
        data,
        error: e,
        count,
      } = await supabase
        .from('shipments')
        .select('*', { count: 'exact' })
        .in('client_id', ids)
        .order('created_at', { ascending: false })
        .limit(TOPE);

      if (!vivo) return;

      if (e) setError(e.message);
      else {
        setError('');
        setEnvios((data ?? []) as Shipment[]);
        setTotal(count ?? 0);
      }
      setCargando(false);
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [ids, version]);

  const hoy = hoyAR();

  /**
   * Los envíos del período elegido.
   *
   * Recorta ANTES de repartir en casilleros para que los números de arriba, las
   * solapas y la lista hablen todos del mismo pedazo de tiempo. Si el período
   * filtrara sólo la lista, arriba diría "33 entregados" y abajo se verían dos.
   */
  const delPeriodo = useMemo(() => {
    const rango = rangoDelPeriodo(periodo, hoy, desde, hasta);
    return envios.filter((s) => entraEnElPeriodo(s, rango));
  }, [envios, periodo, hoy, desde, hasta]);

  /** Cada envío en su casillero, una sola vez para toda la pantalla. */
  const porGrupo = useMemo(() => {
    const cajas = new Map<Grupo, Shipment[]>(ORDEN_GRUPOS.map((g) => [g, [] as Shipment[]]));
    for (const s of delPeriodo) cajas.get(grupoDe(s, hoy))!.push(s);
    return cajas;
  }, [delPeriodo, hoy]);

  const visibles = useMemo(() => {
    const base = grupo === 'todos' ? delPeriodo : (porGrupo.get(grupo) ?? []);
    return ordenar(
      grupo,
      base.filter((s) => coincide(s, busqueda)),
    );
  }, [grupo, delPeriodo, porGrupo, busqueda]);

  async function copiarLink(s: Shipment) {
    try {
      await navigator.clipboard.writeText(trackUrl(s.tracking_code));
      setCopiado(s.tracking_code);
      setTimeout(() => setCopiado(''), 2500);
    } catch {
      setError('El navegador no dejó copiar. Abrí el seguimiento y copiá la dirección de arriba.');
    }
  }

  const faltan = total - envios.length;

  return (
    <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
      {/* ------------------------------------------------ de un vistazo */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Numerito
          titulo="En curso"
          valor={porGrupo.get('en_curso')?.length ?? 0}
          color="var(--edr-yellow)"
        />
        <Numerito
          titulo="Programados"
          valor={porGrupo.get('programado')?.length ?? 0}
          color="var(--edr-muted)"
        />
        <Numerito
          titulo="Entregados"
          valor={porGrupo.get('entregado')?.length ?? 0}
          color="var(--edr-verde-claro)"
        />
        <Numerito
          titulo="No entregados"
          valor={porGrupo.get('no_entregado')?.length ?? 0}
          color="var(--edr-rojo-claro)"
        />
      </div>

      {/* ------------------------------------------------- qué días mirar */}
      <div className="mb-2 flex flex-wrap gap-2">
        {ORDEN_PERIODOS.map((p) => (
          <Pestania
            key={p}
            activo={periodo === p}
            onClick={() => setPeriodo(p)}
            texto={NOMBRE_PERIODO[p]}
          />
        ))}
      </div>

      {periodo === 'fechas' && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
              Desde
            </label>
            <input
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--edr-yellow)]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
              Hasta
            </label>
            <input
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--edr-yellow)]"
            />
          </div>
          {/* Una sola fecha vale: dejar el otro campo vacío es "desde ahí en
              adelante" o "hasta ahí", que es como se pregunta de verdad. */}
          <span className="pb-1 text-[11px] text-[var(--edr-muted)]">
            Podés poner una sola.
          </span>
        </div>
      )}

      {/* ------------------------------------------------------ filtros */}
      <div className="mb-3 flex flex-wrap gap-2">
        {ORDEN_GRUPOS.map((g) => (
          <Pestania
            key={g}
            activo={grupo === g}
            onClick={() => setGrupo(g)}
            texto={NOMBRE_GRUPO[g]}
            cuantos={porGrupo.get(g)?.length ?? 0}
          />
        ))}
        <Pestania
          activo={grupo === 'todos'}
          onClick={() => setGrupo('todos')}
          texto="Todos"
          cuantos={delPeriodo.length}
        />
      </div>

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--edr-muted)]"
          />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código, nombre o dirección"
            className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--edr-yellow)]"
          />
        </div>
        <button
          onClick={() => setVersion((v) => v + 1)}
          disabled={cargando}
          title="Volver a pedir la lista"
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-2 text-xs font-bold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)] disabled:opacity-50"
        >
          <RefreshCw size={16} className={cargando ? 'animate-spin' : ''} />
          {/* Con la palabra al lado y no sólo la flechita, también en el
              teléfono: el comercio entra dos veces por semana y no tiene por
              qué adivinar qué hace un ícono. La búsqueda se achica un poco y
              no pasa nada — el que busca escribe cuatro letras. */}
          Actualizar
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
          {error}
        </div>
      )}

      {/* -------------------------------------------------------- lista */}
      {cargando && envios.length === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--edr-muted)]">Cargando tus envíos…</p>
      ) : visibles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--edr-border)] px-4 py-10 text-center text-sm text-[var(--edr-muted)]">
          {busqueda.trim()
            ? `Ningún envío con "${busqueda.trim()}" acá.`
            : grupo === 'todos'
              ? 'Todavía no hay envíos cargados a tu nombre.'
              : VACIO_GRUPO[grupo]}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visibles.map((s) => (
            <Tarjeta
              key={s.id}
              envio={s}
              hoy={hoy}
              local={s.client_id != null ? (nombreDeLocal.get(s.client_id) ?? '') : ''}
              copiado={copiado === s.tracking_code}
              desdeLaOficina={desdeLaOficina}
              onCopiar={() => copiarLink(s)}
              onComprobante={() => setComprobante(s)}
            />
          ))}
        </div>
      )}

      {faltan > 0 && (
        <p className="mt-3 text-center text-xs text-[var(--edr-muted)]">
          Se muestran los {envios.length} envíos más nuevos. Hay {faltan} más viejos: pedilos por
          WhatsApp y te los pasamos.
        </p>
      )}

      {/*
        El mismo comprobante que usa la oficina: la misma foto, los mismos
        datos, el mismo PDF.

        Con una diferencia: acá se ven sólo los movimientos que CIERRAN el
        envío. Que se retiró a las 12:25 y salió a la calle a las 15:10 es la
        cocina nuestra, no la prueba de nada. Va así también cuando lo mira la
        oficina desde la ficha del comercio, porque esa pantalla existe para
        ver lo mismo que él.
      */}
      <ProofOfDeliveryModal
        shipment={comprobante}
        onClose={() => setComprobante(null)}
        paraElComercio
      />
    </div>
  );
}

/* ------------------------------------------------------------------ piezas */

function Numerito({ titulo, valor, color }: { titulo: string; valor: number; color: string }) {
  return (
    <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2">
      <div className="edr-mono text-2xl font-black leading-none" style={{ color }}>
        {valor}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-[var(--edr-muted)]">
        {titulo}
      </div>
    </div>
  );
}

function Pestania({
  activo,
  onClick,
  texto,
  cuantos,
}: {
  activo: boolean;
  onClick: () => void;
  texto: string;
  /** Sin número para los períodos: ahí el número sería el mismo de la solapa. */
  cuantos?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
        activo
          ? 'border-[var(--edr-yellow)] bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
          : 'border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
      }`}
    >
      {texto}
      {cuantos !== undefined && (
        <span className={`edr-mono ml-1.5 ${activo ? '' : 'text-[var(--edr-acento)]'}`}>
          {cuantos}
        </span>
      )}
    </button>
  );
}

/**
 * El día en que se hace el envío, dicho como lo diría una persona.
 *
 * "13/08" a secas obliga a mirar el calendario para saber si eso fue anteayer
 * o la semana pasada. Con el día de la semana adelante —y con "hoy" y "ayer"
 * escritos— la fecha se entiende sin contar.
 */
function diaDelEnvio(s: Shipment, hoy: string): string {
  if (!s.scheduled_date) return diaAR(s.created_at);

  const corto = s.scheduled_date.split('-').reverse().slice(0, 2).join('/');
  if (s.scheduled_date === hoy) return `hoy ${corto}`;
  if (s.scheduled_date > hoy) return `${corto} · ${cuandoSeHace(s.scheduled_date, hoy)}`;

  const ayer = new Date(Date.parse(`${hoy}T00:00:00`) - 86_400_000).toISOString().slice(0, 10);
  if (s.scheduled_date === ayer) return `ayer ${corto}`;

  const dia = new Date(`${s.scheduled_date}T00:00:00`).toLocaleDateString('es-AR', {
    weekday: 'short',
  });
  return `${dia} ${corto}`;
}

/**
 * Qué plata hay en juego, contada desde el comercio.
 *
 * Sólo lo que le sirve saber: cuánto le van a cobrar al destinatario y cuánto
 * sale el envío. Lo demás —quién rinde qué, la comisión— es de la caja, y la
 * caja no es asunto del comercio.
 */
function plataDelEnvio(s: Shipment): string {
  const partes: string[] = [];

  if (s.payment_mode === 'cobrar_destinatario' && Number(s.amount_to_collect) > 0) {
    partes.push(`Cobran ${money(s.amount_to_collect)} en la puerta`);
  } else {
    partes.push(PAYMENT_LABEL[s.payment_mode]);
  }

  if (Number(s.shipping_fee) > 0) partes.push(`envío ${money(s.shipping_fee)}`);

  return partes.join(' · ');
}

function Tarjeta({
  envio: s,
  hoy,
  local,
  copiado,
  desdeLaOficina,
  onCopiar,
  onComprobante,
}: {
  envio: Shipment;
  hoy: string;
  /** De qué local salió. Vacío cuando el comercio tiene uno solo. */
  local: string;
  copiado: boolean;
  desdeLaOficina: boolean;
  onCopiar: () => void;
  onComprobante: () => void;
}) {
  const grupo = grupoDe(s, hoy);
  const cerrado = estaCerrado(grupo);

  return (
    <article className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`${chipBase} ${STATUS_CLASS[s.status]}`}>{ETIQUETA_ESTADO[s.status]}</span>
        <span className="edr-mono text-xs text-[var(--edr-muted)]">{s.tracking_code}</span>
        {local && (
          <span className="rounded bg-[var(--edr-surface-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--edr-muted)]">
            {local}
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--edr-muted)]">{diaDelEnvio(s, hoy)}</span>
      </div>

      <div className="font-bold leading-tight">{nombreDelDestinatario(s)}</div>
      <div className="text-sm text-[var(--edr-muted)]">
        {s.address_street}
        {s.address_extra ? ` — ${s.address_extra}` : ''}, {s.city}
        {s.recipient_phone ? ` · ${s.recipient_phone}` : ''}
      </div>

      {(s.product_detail || s.delivery_window || s.notes) && (
        <div className="mt-1 text-xs text-[var(--edr-muted)]">
          {[s.product_detail, s.delivery_window && `Horario: ${s.delivery_window}`, s.notes]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}

      <div className="mt-1 text-xs font-semibold text-[var(--edr-acento)]">{plataDelEnvio(s)}</div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        {cerrado ? (
          /* Ya pasó: lo que se busca es la prueba de qué pasó. */
          <button
            onClick={onComprobante}
            className="inline-flex items-center gap-1.5 rounded bg-[var(--edr-yellow)] px-3 py-1.5 text-xs font-black text-[var(--edr-blue)] hover:brightness-95"
          >
            <FileText size={14} /> Ver comprobante
          </button>
        ) : (
          /* Todavía está pasando: lo que se busca es el link para mandar. */
          <button
            onClick={onCopiar}
            className="inline-flex items-center gap-1.5 rounded bg-[var(--edr-yellow)] px-3 py-1.5 text-xs font-black text-[var(--edr-blue)] hover:brightness-95"
          >
            <Copy size={14} /> {copiado ? '¡Copiado!' : 'Copiar link de seguimiento'}
          </button>
        )}

        {/* El seguimiento se abre siempre, esté cerrado o no: es la pantalla
            que ve el destinatario, y el comercio la quiere ver igual que él. */}
        <a
          href={trackUrl(s.tracking_code)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
        >
          <ExternalLink size={14} /> Seguimiento
        </a>

        {cerrado && (
          <button
            onClick={onCopiar}
            className="inline-flex items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
          >
            <Copy size={14} /> {copiado ? '¡Copiado!' : 'Copiar link'}
          </button>
        )}

        {/* Sólo para la oficina: la lista es de lectura, y para tocar el envío
            está el panel, que es donde vive el editor de verdad. */}
        {desdeLaOficina && (
          <a
            href={`/admin?buscar=${encodeURIComponent(s.tracking_code)}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold text-[var(--edr-acento)] hover:bg-[var(--edr-surface-2)]"
          >
            <Pencil size={14} /> Abrir en el panel
          </a>
        )}
      </div>
    </article>
  );
}
