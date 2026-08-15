'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import AddShipmentModal from '@/components/AddShipmentModal';
import ShippingLabel from '@/components/ShippingLabel';
import PrintPortal from '@/components/PrintPortal';
import { notificarRepartidor } from '@/lib/notify';
import ProofOfDeliveryModal from '@/components/ProofOfDeliveryModal';
import ShipmentMobileCard from '@/components/admin/ShipmentMobileCard';
import CerrarEnvio, { type Cierre } from '@/components/admin/CerrarEnvio';
import ReprogramarEnvio from '@/components/admin/ReprogramarEnvio';
import CopyTrackLink from '@/components/admin/CopyTrackLink';
import { trackUrl } from '@/lib/trackUrl';
import { armarZip } from '@/lib/zip';
import { photoFileName, photoPaths, type ProofLog } from '@/lib/proof';
import { hoyLocal } from '@/lib/scheduled';
import { dayShift } from '@/lib/settlement';
import {
  money,
  shipmentCash,
  STATUS_CLASS,
  ETIQUETA_ESTADO,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/format';

interface Driver {
  id: string;
  full_name: string;
}

/**
 * Lo que la tabla acepta que le pidan por la dirección.
 *
 * Es lo que hace que los avisos del Panel del día sirvan: el botón
 * "REPROGRAMAR" de un aviso tiene que dejar el envío a la vista, no en la
 * sección de envíos a que lo busque a mano. `?buscar=`, `?repartidor=` y
 * `?nuevo=1`.
 *
 * Se lee del navegador y no con `useSearchParams` a propósito: ese hook obliga
 * a envolver la pantalla en un `<Suspense>` para poder generarla de antemano, y
 * acá sólo se usa para el estado inicial. Como la pantalla arranca mostrando
 * "Cargando…" hasta que el guardia dice que sos admin, lo que se lea acá no
 * cambia el primer dibujo y no hay nada que se pueda desincronizar.
 */
function alAbrir(nombre: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(nombre) ?? '';
}

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

/**
 * Marca de envío FLEX.
 *
 * Va con la palabra escrita a propósito. En el panel el amarillo ya significa
 * plata a cobrar (los totales, la columna "A cobrar"), así que pintar la fila
 * de amarillo dejaría sin saber si el color dice "cobrá" o "es flex" en las
 * filas que tienen las dos cosas. Con la etiqueta no hay ambigüedad.
 */
function FlexBadge() {
  return (
    <span
      title="Se cierra en la app de Mercado Libre Flex"
      className="ml-1.5 rounded bg-[var(--edr-yellow)] px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide text-black"
    >
      Flex
    </span>
  );
}

/** Un número del resumen del período. */
function Contador({ label, valor, clase = '' }: { label: string; valor: number; clase?: string }) {
  return (
    <span className="text-xs text-[var(--edr-muted)]">
      <span className={`edr-mono text-base font-black ${clase}`}>{valor}</span> {label}
    </span>
  );
}

/** Estados en los que ya existe una prueba de entrega para mirar */
const HAS_PROOF: ShipmentStatus[] = ['entregado', 'pendiente_entrega'];

/** Ya no se mueven: no tiene sentido buscarles el punto ni marcarlos. */
const CERRADOS: ShipmentStatus[] = ['entregado', 'cancelado'];

/**
 * ¿Hay que ubicarlo todavía?
 *
 * El punto sirve para llegar, así que sólo importa en lo que falta repartir.
 * Marcar un envío entregado de hace tres semanas sería ensuciar el historial
 * con algo que ya no se puede hacer.
 */
const faltaUbicar = (s: Shipment) => s.lat == null && !CERRADOS.includes(s.status);

/** Mismo criterio que en Estadísticas: los atajos sólo completan las fechas. */
const ATAJOS = [
  { label: 'Hoy', desde: 0, hasta: 0 },
  { label: 'Mañana', desde: 1, hasta: 1 },
  { label: 'Ayer', desde: -1, hasta: -1 },
  { label: 'Últimos 7 días', desde: -6, hasta: 0 },
] as const;

interface Filtros {
  desde: string;
  hasta: string;
  /** '' = todos · 'sin_asignar' = los que todavía no tienen repartidor. */
  driver: string;
  /** Con texto se busca en TODAS las fechas: ver más abajo por qué. */
  search: string;
}

/**
 * Consulta suelta, sin estado adentro: se puede disparar desde un efecto.
 *
 * Cuando hay algo escrito en el buscador se ignoran las fechas y se busca en
 * todo. Si no, buscar un código que resultó ser de la semana pasada no
 * devolvería nada y parecería que el envío no existe.
 */
function fetchShipments(f: Filtros) {
  let q = supabase.from('shipments').select('*, driver:assigned_driver(full_name)');

  if (!f.search.trim()) {
    const [a, b] = f.desde <= f.hasta ? [f.desde, f.hasta] : [f.hasta, f.desde];
    q = q.gte('scheduled_date', a).lte('scheduled_date', b);
  }

  if (f.driver === 'sin_asignar') q = q.is('assigned_driver', null);
  else if (f.driver) q = q.eq('assigned_driver', f.driver);

  return q.order('id', { ascending: false }).limit(300);
}

function fetchDrivers() {
  return supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'repartidor')
    .eq('active', true);
}

export default function AdminPage() {
  /** Sólo admin: un repartidor logueado no tiene que poder mirar acá. */
  const ready = useAdminGuard();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(() => alAbrir('buscar'));
  /** Lo que realmente se le pide al servidor: se aplica al soltar el teclado. */
  const [searchAplicada, setSearchAplicada] = useState(() => alAbrir('buscar'));
  const [desde, setDesde] = useState(() => hoyLocal());
  const [hasta, setHasta] = useState(() => hoyLocal());
  const [driverFilter, setDriverFilter] = useState(() =>
    alAbrir('repartidor') === 'sin_asignar' ? 'sin_asignar' : '',
  );
  const [statusFilter, setStatusFilter] = useState<'todos' | ShipmentStatus>('todos');
  /** Los FLEX se cierran en la app de Mercado Libre: a veces hay que verlos solos. */
  const [soloFlex, setSoloFlex] = useState(false);
  /** Ver sólo los que quedaron con un intento fallido, para reprogramarlos. */
  const [soloFallidos, setSoloFallidos] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [modalOpen, setModalOpen] = useState(() => alAbrir('nuevo') === '1');
  const [editing, setEditing] = useState<Shipment | null>(null);
  /**
   * Las etiquetas que se están por imprimir.
   *
   * Es una lista y no una sola porque la hoja de estilos ya sabe separar
   * etiquetas con un salto de página: imprimir ocho de una era cuestión de
   * dibujarlas todas, en vez de abrir ocho veces el mismo cuadro de impresión.
   */
  const [toPrint, setToPrint] = useState<Shipment[]>([]);
  const [proof, setProof] = useState<Shipment | null>(null);
  /** El envío que se está cerrando a mano desde el panel. */
  const [cerrando, setCerrando] = useState<Shipment | null>(null);

  /** El envío que se está reprogramando para otro día. */
  const [reprogramando, setReprogramando] = useState<Shipment | null>(null);

  /** Con qué solapa abre el cuadro. El botón "Cerrar" no elige; el
   *  desplegable sí, porque ahí ya dijo si fue entregado o no. */
  const [cierreInicial, setCierreInicial] = useState<Cierre>('no_entregado');

  /**
   * Abre el cuadro de cierre. Va por acá SIEMPRE, para que la solapa no quede
   * pegada de la vez anterior: elegir "Entregado" en el desplegable y después
   * tocar "Cerrar" en otro envío abriría el segundo en entregado.
   */
  function abrirCierre(s: Shipment, tipo: Cierre = 'no_entregado') {
    setCierreInicial(tipo);
    setCerrando(s);
  }
  /** Los envíos tildados para asignarlos de una. */
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [asignandoLote, setAsignandoLote] = useState(false);
  const [copiados, setCopiados] = useState(false);
  const [copiando, setCopiando] = useState(false);
  /** Cómo va la bajada de fotos: "12 de 30". Vacío cuando no está bajando. */
  const [bajandoFotos, setBajandoFotos] = useState('');
  const [error, setError] = useState('');

  const applyShipments = useCallback(
    ({ data, error: dbError }: Awaited<ReturnType<typeof fetchShipments>>) => {
      if (dbError) setError(dbError.message);
      else setShipments((data ?? []) as Shipment[]);
      setLoading(false);
    },
    [],
  );

  /** Refresco a mano, después de guardar, borrar o cambiar un envío. */
  const load = useCallback(() => {
    setLoading(true);
    return fetchShipments({ desde, hasta, driver: driverFilter, search: searchAplicada }).then(
      applyShipments,
    );
  }, [applyShipments, desde, hasta, driverFilter, searchAplicada]);

  /**
   * El botón "+ Nuevo envío" de la barra de arriba.
   *
   * Vive en el marco, que no se vuelve a dibujar al cambiar de sección: por eso
   * no puede abrir el cuadro llamando a `setModalOpen`. Desde otra sección va
   * por la dirección (`?nuevo=1`); estando ya acá, avisa por este aviso, porque
   * navegar a la misma pantalla no la vuelve a montar y el cuadro no se abriría.
   */
  useEffect(() => {
    const abrir = () => {
      setEditing(null);
      setModalOpen(true);
    };
    const buscar = (e: Event) => {
      const q = (e as CustomEvent<string>).detail ?? '';
      setSearch(q);
      setSearchAplicada(q);
    };

    window.addEventListener('edr-nuevo-envio', abrir);
    window.addEventListener('edr-buscar', buscar);
    return () => {
      window.removeEventListener('edr-nuevo-envio', abrir);
      window.removeEventListener('edr-buscar', buscar);
    };
  }, []);

  /**
   * Se limpia la dirección después de leerla.
   *
   * Si `?nuevo=1` se queda pegado, recargar la página vuelve a abrir el cuadro
   * de carga, y el que quería ver la tabla se lo encuentra encima otra vez.
   * Se conserva el estado del router de Next: pisarlo le rompe el "atrás".
   */
  useEffect(() => {
    if (!window.location.search) return;
    window.history.replaceState(window.history.state, '', '/admin');
  }, []);

  // Se espera a que deje de tipear: si no, cada tecla dispara una consulta.
  useEffect(() => {
    const t = setTimeout(() => setSearchAplicada(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    fetchShipments({ desde, hasta, driver: driverFilter, search: searchAplicada }).then((res) => {
      if (!cancelled) applyShipments(res);
    });

    return () => {
      cancelled = true;
    };
  }, [ready, desde, hasta, driverFilter, searchAplicada, applyShipments]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchDrivers().then(({ data }) => {
      if (!cancelled) setDrivers((data ?? []) as Driver[]);
    });
    return () => {
      cancelled = true;
    };
  }, [ready]);

  async function remove(s: Shipment) {
    // Borrar un envío que ya está en la calle deja al repartidor con una entrega
    // imposible de cerrar: cuando su celular la mande, el servidor contesta
    // ENVIO_NO_ENCONTRADO y el comprobante (foto, firma, GPS) se pierde.
    const enLaCalle = s.assigned_driver && s.status !== 'creado' && s.status !== 'cancelado';

    const aviso = enLaCalle
      ? `OJO: ${s.tracking_code} ya lo tiene ${s.driver?.full_name ?? 'un repartidor'} ` +
        `(${ETIQUETA_ESTADO[s.status]}).\n\n` +
        'Si lo borrás y él ya lo cerró en el celular, esa entrega se va a rechazar y ' +
        'pierde la foto y el GPS.\n\nConviene marcarlo como "Cancelado" en vez de borrarlo.\n\n' +
        '¿Borrar igual?'
      : `¿Eliminar el envío ${s.tracking_code}? No se puede deshacer.`;

    if (!confirm(aviso)) return;
    const { error: dbError } = await supabase.from('shipments').delete().eq('id', s.id);
    if (dbError) setError(dbError.message);
    else void load();
  }

  async function assignDriver(s: Shipment, driverId: string) {
    const { error: dbError } = await supabase
      .from('shipments')
      .update({
        assigned_driver: driverId || null,
        assigned_at: driverId ? new Date().toISOString() : null,
        status: driverId && s.status === 'creado' ? 'pendiente_retiro' : s.status,
      })
      .eq('id', s.id);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    // Asignado a mano: el repartidor no lo escaneó, así que si no le avisamos
    // no se entera hasta que abra la app por casualidad.
    if (driverId) {
      void notificarRepartidor({
        driverId,
        title: 'Te asignaron un envío',
        body: `${s.address_street}${s.city ? `, ${s.city}` : ''} · ${s.tracking_code}`,
        url: '/driver/dashboard',
        tag: `envio-${s.id}`,
      });
    }

    void load();
  }

  const alternarSeleccion = (id: number) =>
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  /**
   * Los seguimientos de todo lo tildado, listos para pegar en WhatsApp.
   *
   * Un comercio con seis envíos en el día pide los seis links, y mandarlos de
   * a uno es abrir seis veces la misma pantalla. Va la dirección arriba de
   * cada link porque el que los recibe necesita saber cuál es cuál: seis
   * códigos EDR pelados no se distinguen entre sí.
   *
   * En el orden de la tabla y no en el que se fueron tildando: así la lista
   * que se pega coincide con la que se está mirando.
   */
  async function textoSeguimientos(): Promise<string> {
    const elegidos = visible.filter((s) => seleccion.has(s.id));
    if (!elegidos.length) return '';

    /*
     * El link de la etiqueta lo firma el servidor. No se puede armar acá: la
     * firma sale de un secreto que, si viajara al navegador, dejaría a
     * cualquiera fabricar la etiqueta de cualquier envío.
     */
    const { data: sesion } = await supabase.auth.getSession();

    /*
     * Sin sesión no hay etiquetas, y hay que decirlo.
     *
     * Acá estaba el problema: si el servidor contestaba que no —lo más común,
     * una pestaña que llevaba horas abierta y se quedó sin sesión— el texto
     * salía igual pero con la mitad, y el cartel decía "copiado". Uno pega eso
     * en WhatsApp y recién ahí se entera de que faltaba la etiqueta.
     *
     * Ahora el aviso es explícito. El seguimiento se copia lo mismo: media
     * lista sirve, ninguna no.
     */
    if (!sesion.session?.access_token) {
      setError('Se cerró tu sesión: se copian los seguimientos, pero no las etiquetas. Recargá la página.');
    }

    const res = await fetch('/api/etiquetas', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sesion.session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ codigos: elegidos.map((s) => s.tracking_code) }),
    });

    const etiquetas = new Map<string, string>();

    if (res.ok) {
      const { links } = (await res.json()) as { links?: { codigo: string; url: string }[] };
      for (const l of links ?? []) etiquetas.set(l.codigo, l.url);
    } else if (sesion.session?.access_token) {
      const detalle = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        res.status === 403
          ? 'El servidor no te reconoció como administrador: se copian los seguimientos, pero no las etiquetas. Recargá la página y probá de nuevo.'
          : `No se pudieron armar los links de etiqueta (${detalle.error ?? res.status}). Los seguimientos sí se copiaron.`,
      );
    }

    // Un código sin link es lo mismo que ninguno: si el servidor contestó bien
    // pero le faltó alguno, tampoco puede pasar en silencio.
    const faltan = elegidos.filter((s) => !etiquetas.has(s.tracking_code));
    if (res.ok && faltan.length) {
      setError(
        `Sin etiqueta: ${faltan.map((s) => s.tracking_code).join(', ')}. El resto se copió completo.`,
      );
    }

    return elegidos
      .map((s) =>
        [
          [s.address_street, s.address_extra].filter(Boolean).join(' '),
          `Seguimiento: ${trackUrl(s.tracking_code)}`,
          // Si el servidor no contestó va el seguimiento igual: media lista
          // sirve, ninguna no.
          etiquetas.has(s.tracking_code) ? `Etiqueta: ${etiquetas.get(s.tracking_code)}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
      .join('\n\n');
  }

  async function copiarSeguimientos() {
    setCopiando(true);
    let texto = '';
    try {
      texto = await textoSeguimientos();
    } catch {
      setError('No se pudieron armar los links de las etiquetas: revisá la conexión.');
    }
    setCopiando(false);
    if (!texto) return;

    try {
      await navigator.clipboard.writeText(texto);
      setCopiados(true);
      setTimeout(() => setCopiados(false), 2500);
    } catch {
      // Sin permiso de portapapeles: mostrarlo alcanza para copiarlo a mano.
      prompt('Copiá los seguimientos:', texto);
    }
  }

  /**
   * Baja las fotos de todos los tildados, en un solo archivo.
   *
   * De a una era imposible: una jornada son treinta fotos y treinta clics, y
   * el navegador además frena las descargas seguidas por las dudas.
   *
   * Se bajan de a una y se juntan acá —el ZIP se arma en la computadora, no en
   * el servidor— así no hay que subir nada ni esperar a que alguien lo prepare.
   * Ver `lib/zip.ts`.
   */
  async function bajarFotos() {
    const elegidos = visible.filter((s) => seleccion.has(s.id));
    if (!elegidos.length) return;

    setError('');
    setBajandoFotos('buscando…');

    try {
      const { data, error: dbError } = await supabase
        .from('delivery_logs')
        .select('id, event, happened_at, photo_path, photo_path_2, shipment_id')
        .in(
          'shipment_id',
          elegidos.map((s) => s.id),
        )
        .not('photo_path', 'is', null)
        .order('happened_at');

      if (dbError) throw new Error(dbError.message);

      const codigo = new Map(elegidos.map((s) => [s.id, s.tracking_code]));
      const logs = (data ?? []) as unknown as (ProofLog & { shipment_id: number })[];

      // Cada movimiento puede traer hasta dos fotos.
      const pendientes = logs.flatMap((log) =>
        photoPaths(log).map((path, i) => ({
          path,
          nombre: photoFileName(codigo.get(log.shipment_id) ?? 'SIN-CODIGO', log, i),
        })),
      );

      if (!pendientes.length) {
        setBajandoFotos('');
        setError('Los envíos tildados no tienen ninguna foto todavía.');
        return;
      }

      const archivos: { nombre: string; datos: Uint8Array<ArrayBuffer> }[] = [];
      const fallaron: string[] = [];

      for (const [i, f] of pendientes.entries()) {
        setBajandoFotos(`${i + 1} de ${pendientes.length}`);
        const { data: blob } = await supabase.storage.from('delivery-photos').download(f.path);
        if (!blob) {
          fallaron.push(f.nombre);
          continue;
        }
        archivos.push({ nombre: f.nombre, datos: new Uint8Array(await blob.arrayBuffer()) });
      }

      if (!archivos.length) throw new Error('No se pudo bajar ninguna de las fotos.');

      const url = URL.createObjectURL(armarZip(archivos));
      const a = document.createElement('a');
      a.href = url;
      a.download = `fotos-${desde}${hasta !== desde ? `-a-${hasta}` : ''}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Sin esto el archivo queda ocupando memoria hasta cerrar la pestaña.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      // Si alguna no vino, se dice: un archivo con menos fotos de las que
      // esperaba y sin avisar es peor que no bajarlo.
      if (fallaron.length) {
        setError(`Bajaron ${archivos.length} fotos. No se pudieron traer: ${fallaron.join(', ')}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron bajar las fotos.');
    } finally {
      setBajandoFotos('');
    }
  }

  /**
   * Asigna todos los tildados a la vez.
   *
   * Se hace en dos pasos porque el estado no se puede pisar parejo: un envío
   * en 'creado' pasa a 'pendiente_retiro' al asignarse, pero uno que ya está
   * retirado o en camino tiene que quedarse donde está. Mandarle el mismo
   * estado a todos lo haría retroceder.
   */
  async function asignarSeleccion(driverId: string) {
    const ids = [...seleccion];
    if (!ids.length) return;

    setAsignandoLote(true);
    setError('');

    const { error: e1 } = await supabase
      .from('shipments')
      .update({
        assigned_driver: driverId || null,
        assigned_at: driverId ? new Date().toISOString() : null,
      })
      .in('id', ids);

    if (e1) {
      setAsignandoLote(false);
      setError(e1.message);
      return;
    }

    if (driverId) {
      const reciencreados = shipments
        .filter((s) => ids.includes(s.id) && s.status === 'creado')
        .map((s) => s.id);

      if (reciencreados.length) {
        await supabase
          .from('shipments')
          .update({ status: 'pendiente_retiro' })
          .in('id', reciencreados);
      }

      // Un aviso por tanda: ocho seguidos en el celular de alguien que está
      // manejando no son ocho avisos, son una molestia que se descarta.
      const primero = shipments.find((s) => s.id === ids[0]);
      void notificarRepartidor({
        driverId,
        title: ids.length === 1 ? 'Te asignaron un envío' : `Te asignaron ${ids.length} envíos`,
        body:
          ids.length === 1
            ? `${primero?.address_street ?? ''} · ${primero?.tracking_code ?? ''}`
            : `${primero?.address_street ?? ''} y ${ids.length - 1} más`,
        url: '/driver/dashboard',
        tag: 'asignacion',
      });
    }

    setSeleccion(new Set());
    setAsignandoLote(false);
    void load();
  }

  async function changeStatus(s: Shipment, status: ShipmentStatus) {
    /*
     * Cerrar un envío —para bien o para mal— no es cambiar una casilla: es
     * registrar cómo terminó, y eso necesita el motivo o quién recibió. Sin
     * eso el seguimiento del cliente no puede decir qué pasó, que es
     * justamente lo que va a preguntar.
     *
     * Así que esas dos opciones abren el mismo cuadro que el botón "Cerrar",
     * en vez de hacer un cambio mudo.
     */
    if (status === 'pendiente_entrega' || status === 'entregado') {
      abrirCierre(s, status === 'entregado' ? 'entregado' : 'no_entregado');
      return;
    }

    /*
     * El resto pasa por la función del paso 28 en vez de escribir la casilla
     * directo. La diferencia: retirado y en camino quedan anotados en el
     * historial, con su hora.
     *
     * Antes el desplegable movía la casilla y nada más, así que un envío
     * marcado retirado desde acá no mostraba ese paso en el seguimiento del
     * cliente ni en el comprobante. Volver atrás, en cambio, sigue sin anotar
     * nada: eso es corregir un error de carga, no un hecho de la calle.
     */
    const { error: dbError } = await supabase.rpc('cambiar_estado_admin', {
      p_shipment_id: s.id,
      p_status: status,
    });

    if (dbError) {
      const m = dbError.message;
      setError(
        m.includes('SOLO_ADMIN')
          ? 'Sólo un administrador puede cambiar el estado.'
          : m.includes('USAR_CERRAR')
            ? 'Para entregado y no entregado usá el botón "Cerrar": ahí queda el motivo o quién recibió.'
            : m.includes('ENVIO_NO_ENCONTRADO')
              ? 'Ese envío ya no está.'
              : m,
      );
      return;
    }

    void load();
  }

  /**
   * Busca las coordenadas de los envíos que todavía no las tienen.
   *
   * El servidor procesa de a seis por llamada, porque el buscador de
   * direcciones acepta una consulta por segundo y una tanda larga se cortaría
   * por tiempo. Se lo llama de nuevo mientras avise que quedan más.
   */
  async function ubicarPendientes() {
    setUbicando(true);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      for (let vuelta = 0; vuelta < 10; vuelta++) {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.session?.access_token ?? ''}`,
          },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'No se pudo ubicar.');
        if (!json.quedanMas || json.procesados === 0) break;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron ubicar los envíos.');
    }
    setUbicando(false);
  }

  function print(envios: Shipment[]) {
    if (!envios.length) return;
    setToPrint(envios);
    // El respiro es para que React alcance a dibujar las etiquetas antes de
    // que el navegador saque la foto de la página.
    setTimeout(() => window.print(), 250);
  }

  const visible = shipments.filter((s) => {
    const okFlex = !soloFlex || Boolean(s.is_flex);
    // "No entregado" no es un estado del envío sino lo que le pasó: el envío
    // queda en 'pendiente_entrega', esperando que se lo vuelva a intentar.
    const okFallidos = !soloFallidos || s.status === 'pendiente_entrega';
    const okStatus = statusFilter === 'todos' || s.status === statusFilter;
    const q = search.trim().toLowerCase();
    const okSearch =
      !q ||
      s.tracking_code?.toLowerCase().includes(q) ||
      s.recipient_name.toLowerCase().includes(q) ||
      s.address_street.toLowerCase().includes(q) ||
      (s.client_name_raw ?? '').toLowerCase().includes(q);
    return okFlex && okFallidos && okStatus && okSearch;
  });

  // Suma las dos cobranzas: la de la puerta y la que se le cobra al comercio
  // al retirar. Antes sólo contaba la primera y el total quedaba corto.
  const totales = visible.reduce(
    (acc, s) => {
      const cash = shipmentCash(s);
      return { puerta: acc.puerta + cash.atDelivery, retiro: acc.retiro + cash.atPickup };
    },
    { puerta: 0, retiro: 0 },
  );

  /** Cómo viene el período: lo primero que se mira al abrir el panel. */
  const resumen = {
    total: visible.length,
    entregados: visible.filter((s) => s.status === 'entregado').length,
    // Sobre lo traído y no sobre lo visible: es un botón de filtro, y un
    // número que se explica a sí mismo al apretarlo no sirve para nada.
    fallidos: shipments.filter((s) => s.status === 'pendiente_entrega').length,
    enCalle: visible.filter((s) => s.status === 'retirado' || s.status === 'en_camino').length,
    sinSalir: visible.filter((s) => s.status === 'creado' || s.status === 'pendiente_retiro').length,
    // Se cuenta sobre lo traído, no sobre lo visible: si no, con el filtro
    // prendido el número se explicaría a sí mismo y no serviría de nada.
    flex: shipments.filter((s) => s.is_flex).length,
    // Mismo criterio que la marca de cada fila: si el número dijera una cosa y
    // las filas marcadas fueran otras, no se le podría creer a ninguno.
    sinUbicar: shipments.filter(faltaUbicar).length,
  };

  const buscando = Boolean(search.trim());
  const periodo =
    desde === hasta
      ? desde === hoyLocal()
        ? 'Hoy'
        : desde.split('-').reverse().slice(0, 2).join('/')
      : `${desde.split('-').reverse().slice(0, 2).join('/')} al ${hasta
          .split('-')
          .reverse()
          .slice(0, 2)
          .join('/')}`;

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  return (
    <div className="min-h-screen">

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="mb-4 flex flex-wrap items-center gap-2 sm:gap-3">
          {/* En el teléfono el botón va ancho completo y primero: cargar un
              envío desde la calle es la razón principal para entrar acá. */}
          <button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            className="w-full rounded bg-[var(--edr-yellow)] px-4 py-3 text-base font-black text-black hover:brightness-95 sm:w-auto sm:py-2 sm:text-sm"
          >
            + Nuevo envío
          </button>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por código, destinatario, dirección o comercio"
            className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)] sm:max-w-sm"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'todos' | ShipmentStatus)}
            className="flex-1 rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm sm:flex-none"
          >
            <option value="todos">Todos los estados</option>
            {Object.entries(ETIQUETA_ESTADO).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>

          <div className="ml-auto rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-hiviz)] text-black px-3 py-1.5 text-sm font-bold">
            A cobrar: <span className="edr-mono">{money(totales.puerta)}</span>
            {totales.retiro > 0 && (
              <span className="ml-2 rounded bg-orange-500 px-2 py-0.5 text-white">
                al retirar <span className="edr-mono">{money(totales.retiro)}</span>
              </span>
            )}
          </div>
        </div>

        {/* ---------- Qué día y de quién ---------- */}
        <section className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
          <div className="flex flex-wrap items-end gap-2 sm:gap-3">
            <div>
              <label className={labelCls}>Desde</label>
              <input
                type="date"
                value={desde}
                onChange={(e) => {
                  setLoading(true);
                  setDesde(e.target.value);
                  if (e.target.value > hasta) setHasta(e.target.value);
                }}
                className={campo}
              />
            </div>
            <div>
              <label className={labelCls}>Hasta</label>
              <input
                type="date"
                value={hasta}
                min={desde}
                onChange={(e) => {
                  setLoading(true);
                  setHasta(e.target.value);
                }}
                className={campo}
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {ATAJOS.map((a) => {
                const d = dayShift(hoyLocal(), a.desde);
                const h = dayShift(hoyLocal(), a.hasta);
                const activo = desde === d && hasta === h;
                return (
                  <button
                    key={a.label}
                    onClick={() => {
                      setLoading(true);
                      setDesde(d);
                      setHasta(h);
                    }}
                    className={`rounded px-3 py-2 text-xs font-black ${
                      activo
                        ? 'bg-[var(--edr-yellow)] text-black'
                        : 'border border-[var(--edr-border)] text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
                    }`}
                  >
                    {a.label}
                  </button>
                );
              })}
            </div>

            <div className="min-w-[180px] flex-1 sm:flex-none">
              <label className={labelCls}>Repartidor</label>
              <select
                value={driverFilter}
                onChange={(e) => {
                  setLoading(true);
                  setDriverFilter(e.target.value);
                }}
                className={`${campo} w-full`}
              >
                <option value="">Todos los repartidores</option>
                <option value="sin_asignar">Sin asignar</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ---------- Cómo viene el día ---------- */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--edr-border)] pt-3 text-sm">
            <span className="font-black">
              {buscando ? `Resultados de "${search.trim()}"` : periodo}
            </span>
            {buscando ? (
              <span className="text-xs text-[var(--edr-muted)]">
                Buscando en todas las fechas. Borrá el texto para volver al período.
              </span>
            ) : (
              <>
                <Contador label="envíos" valor={resumen.total} />
                <Contador label="entregados" valor={resumen.entregados} clase="text-emerald-400" />
                <Contador label="en la calle" valor={resumen.enCalle} clase="text-sky-300" />
                <Contador label="sin salir" valor={resumen.sinSalir} />
                {/* Se cuenta sobre lo traído y no sobre lo visible, igual que
                    el de flex: con el filtro prendido, un número que se explica
                    a sí mismo no sirve para nada. */}
                <button
                  onClick={() => setSoloFallidos((v) => !v)}
                  title="Ver únicamente los envíos que quedaron sin entregar"
                  className={`rounded px-2 py-0.5 text-xs ${
                    soloFallidos
                      ? 'bg-orange-500 font-black text-black'
                      : 'text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]'
                  }`}
                >
                  <span
                    className={`edr-mono text-base font-black ${
                      soloFallidos ? 'text-black' : 'text-orange-400'
                    }`}
                  >
                    {resumen.fallidos}
                  </span>{' '}
                  no entregados {soloFallidos ? '· ver todos' : ''}
                </button>

                {/* Los envíos nuevos se ubican solos al guardarlos. Este botón
                    es para los que ya estaban cargados de antes. Va a mano y no
                    solo: son consultas a un servicio gratuito con cupo, no es
                    para dispararlas cada vez que alguien abre el panel. */}
                {resumen.sinUbicar > 0 && (
                  <button
                    onClick={ubicarPendientes}
                    disabled={ubicando}
                    className="rounded border border-[var(--edr-border)] px-2 py-0.5 text-xs font-semibold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)] disabled:opacity-50"
                  >
                    {ubicando ? 'Ubicando…' : `📍 ${resumen.sinUbicar} sin ubicar en el mapa`}
                  </button>
                )}

                {/* Sólo aparece si hay alguno: un "0 flex" fijo sería ruido. */}
                {resumen.flex > 0 && (
                  <button
                    onClick={() => setSoloFlex((v) => !v)}
                    title="Ver únicamente los envíos FLEX"
                    className={`rounded px-2 py-0.5 text-xs font-black uppercase ${
                      soloFlex
                        ? 'bg-[var(--edr-yellow)] text-black'
                        : 'border border-[var(--edr-yellow)] text-[var(--edr-yellow)]'
                    }`}
                  >
                    {resumen.flex} flex {soloFlex ? '· ver todos' : ''}
                  </button>
                )}
              </>
            )}
          </div>
        </section>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Teléfono: una tarjeta por envío. La tabla de abajo tiene siete
            columnas y en un celular obliga a arrastrar de costado para llegar
            a los botones, que es justo lo que se necesita desde la calle. */}
        {/* Barra de la selección. Pegada arriba porque con veinte envíos en
            pantalla el botón tiene que seguir a la vista mientras se tilda. */}
        {seleccion.size > 0 && (
          <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface-2)] px-3 py-2">
            <span className="text-sm font-black">
              {seleccion.size} seleccionado{seleccion.size > 1 ? 's' : ''}
            </span>
            <select
              defaultValue=""
              disabled={asignandoLote}
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = '';
                if (v) void asignarSeleccion(v === 'libre' ? '' : v);
              }}
              className={`${campo} disabled:opacity-50`}
            >
              <option value="">Asignar a…</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
              <option value="libre">Sacarles el repartidor</option>
            </select>
            {asignandoLote && <span className="text-xs text-[var(--edr-muted)]">Asignando…</span>}

            <button
              onClick={copiarSeguimientos}
              disabled={copiando}
              title="Copiar dirección, seguimiento y etiqueta de todos los tildados"
              className="rounded border border-[var(--edr-yellow)] px-3 py-1.5 text-xs font-bold text-[var(--edr-yellow)] hover:bg-[var(--edr-surface)] disabled:opacity-50"
            >
              {copiando ? 'Armando…' : copiados ? '✓ Copiados' : '🔗 Copiar seguimiento y etiqueta'}
            </button>

            <button
              onClick={bajarFotos}
              disabled={Boolean(bajandoFotos)}
              title="Bajar las fotos de entrega de todos los tildados, en un solo archivo"
              className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--edr-surface)] disabled:opacity-50"
            >
              {bajandoFotos ? `Bajando fotos… ${bajandoFotos}` : '📷 Bajar fotos'}
            </button>

            <button
              onClick={() => print(visible.filter((s) => seleccion.has(s.id)))}
              title="Imprimir la etiqueta de todos los tildados, una atrás de otra"
              className="rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-bold hover:bg-[var(--edr-surface)]"
            >
              🖨 Imprimir etiquetas
            </button>

            <button
              onClick={() => setSeleccion(new Set())}
              className="ml-auto rounded border border-[var(--edr-border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--edr-surface)]"
            >
              Limpiar selección
            </button>
          </div>
        )}

        <div className="space-y-2 lg:hidden">
          {loading && (
            <p className="py-8 text-center text-sm text-[var(--edr-muted)]">Cargando envíos…</p>
          )}
          {!loading && visible.length === 0 && (
            <p className="py-10 text-center text-sm text-[var(--edr-muted)]">
              {buscando
                      ? `Ningún envío coincide con "${search.trim()}".`
                      : driverFilter
                        ? `Ese repartidor no tiene envíos en ${periodo.toLowerCase()}.`
                        : `No hay envíos para ${periodo.toLowerCase()}. Probá otra fecha o cargá el primero con “+ Nuevo envío”.`}
            </p>
          )}
          {visible.map((s) => (
            <ShipmentMobileCard
              key={s.id}
              shipment={s}
              drivers={drivers}
              hasProof={HAS_PROOF.includes(s.status)}
              mostrarFecha={buscando || desde !== hasta}
              faltaUbicar={faltaUbicar(s)}
              onProof={setProof}
              onEdit={(x) => {
                setEditing(x);
                setModalOpen(true);
              }}
              onPrint={(s) => print([s])}
              onDelete={remove}
              onStatus={changeStatus}
              onAssign={assignDriver}
              onCerrar={s.status === 'cancelado' ? undefined : (x) => abrirCierre(x)}
              onReprogramar={s.status === 'pendiente_entrega' ? setReprogramando : undefined}
              seleccionado={seleccion.has(s.id)}
              onSeleccionar={alternarSeleccion}
            />
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] lg:block">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--edr-border)] bg-[var(--edr-surface-2)] text-left text-[11px] uppercase tracking-wide text-[var(--edr-muted)]">
              <tr>
                <th className="w-8 px-3 py-2">
                  {/* Tilda y destilda todo lo que está a la vista, que es lo
                      que el filtro dejó: "todos" tiene que querer decir todos
                      los que veo, no todos los que existen. */}
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos"
                    checked={visible.length > 0 && visible.every((s) => seleccion.has(s.id))}
                    onChange={(e) =>
                      setSeleccion(e.target.checked ? new Set(visible.map((s) => s.id)) : new Set())
                    }
                  />
                </th>
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Destinatario</th>
                <th className="px-3 py-2">Dirección</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Repartidor</th>
                <th className="px-3 py-2 text-right">A cobrar</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-[var(--edr-muted)]">
                    Cargando envíos…
                  </td>
                </tr>
              )}

              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-[var(--edr-muted)]">
                    {buscando
                      ? `Ningún envío coincide con "${search.trim()}".`
                      : driverFilter
                        ? `Ese repartidor no tiene envíos en ${periodo.toLowerCase()}.`
                        : `No hay envíos para ${periodo.toLowerCase()}. Probá otra fecha o cargá el primero con “+ Nuevo envío”.`}
                  </td>
                </tr>
              )}

              {visible.map((s) => (
                <tr
                  key={s.id}
                  className={`border-b border-[var(--edr-border)] last:border-0 hover:bg-[var(--edr-surface-2)] ${
                    seleccion.has(s.id) ? 'bg-[var(--edr-surface-2)]' : ''
                  }`}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${s.tracking_code}`}
                      checked={seleccion.has(s.id)}
                      onChange={() => alternarSeleccion(s.id)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="edr-mono text-xs font-semibold">{s.tracking_code}</span>
                    {s.is_flex && <FlexBadge />}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{s.recipient_name}</div>
                    <div className="text-xs text-[var(--edr-muted)]">{s.client_name_raw}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div>
                      {s.address_street}
                      {s.address_extra ? ` — ${s.address_extra}` : ''}
                    </div>
                    {/* La marca va pegada a la dirección, que es lo que hay que
                        corregir, y abre el envío para hacerlo de una. */}
                    {faltaUbicar(s) && (
                      <button
                        onClick={() => {
                          setEditing(s);
                          setModalOpen(true);
                        }}
                        title="No lo pudimos ubicar en el mapa. Tocá para corregirlo."
                        className="mt-0.5 rounded border border-amber-400/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-200 hover:bg-amber-950"
                      >
                        📍 Sin ubicar
                      </button>
                    )}
                    <div className="text-xs text-[var(--edr-muted)]">
                      {s.city}
                      {s.delivery_window ? ` · ${s.delivery_window}` : ''}
                      {/* La fecha sólo cuando el listado mezcla días: si se está
                          viendo un día suelto, repetirla en cada fila es ruido. */}
                      {(buscando || desde !== hasta) && (
                        <span className="edr-mono ml-1 text-[var(--edr-yellow)]">
                          {s.scheduled_date.split('-').reverse().slice(0, 2).join('/')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.status}
                      onChange={(e) => changeStatus(s, e.target.value as ShipmentStatus)}
                      className={`rounded px-2 py-1 text-xs font-semibold ring-1 ${STATUS_CLASS[s.status]}`}
                    >
                      {Object.entries(ETIQUETA_ESTADO).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={s.assigned_driver ?? ''}
                      onChange={(e) => assignDriver(s, e.target.value)}
                      className="rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-2 py-1 text-xs"
                    >
                      <option value="">Libre (por escaneo)</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CashCell shipment={s} />
                  </td>
                  {/* Los botones se acomodan en varias líneas en vez de
                      empujar la tabla a lo ancho. Con seis en una sola línea la
                      columna medía 487 px y, en una pantalla de 1024, doscientos
                      de ellos quedaban afuera del marco: había que arrastrar la
                      tabla de costado para llegar a "Eliminar". */}
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      <CopyTrackLink trackingCode={s.tracking_code} />
                      {HAS_PROOF.includes(s.status) && (
                        <button
                          onClick={() => setProof(s)}
                          className="rounded border-2 border-[var(--edr-yellow)] px-2 py-1 text-xs font-bold hover:bg-[var(--edr-surface-2)]"
                        >
                          Prueba
                        </button>
                      )}
                      {/* Sólo lo que no se pudo entregar se reintenta: nace un
                          envío nuevo para otro día y el intento fallido se
                          queda en el suyo. */}
                      {s.status === 'pendiente_entrega' && (
                        <button
                          onClick={() => setReprogramando(s)}
                          title="Volver a intentarlo otro día"
                          className="rounded border border-sky-400 px-2 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-950"
                        >
                          Reprogramar
                        </button>
                      )}
                      {/* Un envío cancelado no se cierra: esa historia terminó.
                          Uno entregado sí se puede abrir, para corregir a "no
                          entregado" cuando se cerró mal. */}
                      {s.status !== 'cancelado' && (
                        <button
                          onClick={() => abrirCierre(s)}
                          title="Registrar la entrega o el intento fallido"
                          className="rounded border border-orange-400 px-2 py-1 text-xs font-semibold text-orange-300 hover:bg-orange-950"
                        >
                          Cerrar
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditing(s);
                          setModalOpen(true);
                        }}
                        className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => print([s])}
                        className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                      >
                        Imprimir
                      </button>
                      <button
                        onClick={() => remove(s)}
                        className="rounded border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      <AddShipmentModal
        open={modalOpen}
        editing={editing}
        drivers={drivers}
        onClose={() => setModalOpen(false)}
        onSaved={load}
      />

      <ProofOfDeliveryModal shipment={proof} onClose={() => setProof(null)} />

      {reprogramando && (
        <ReprogramarEnvio
          shipment={reprogramando}
          onCerrar={() => setReprogramando(null)}
          onListo={load}
        />
      )}

      {cerrando && (
        <CerrarEnvio
          shipment={cerrando}
          inicial={cierreInicial}
          onCerrar={() => setCerrando(null)}
          onListo={load}
        />
      )}

      {toPrint.length > 0 && (
        <PrintPortal>
          {toPrint.map((s) => (
            <ShippingLabel key={s.id} shipment={s} />
          ))}
        </PrintPortal>
      )}
    </div>
  );
}

/**
 * Plata del envío, separada por MOMENTO de cobro:
 *  - amarillo: se cobra en la puerta, al entregar
 *  - naranja:  se le cobra al comercio al retirar
 * Son dos momentos distintos y confundirlos hace que se cobre dos veces.
 */
function CashCell({ shipment }: { shipment: Shipment }) {
  const cash = shipmentCash(shipment);
  if (cash.total === 0) return <span className="text-xs text-[var(--edr-muted)]">—</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      {cash.atDelivery > 0 && (
        <span className="edr-mono inline-block bg-[var(--edr-hiviz)] px-2 py-1 font-bold text-black">
          {money(cash.atDelivery)}
        </span>
      )}
      {cash.atPickup > 0 && (
        <span className="edr-mono inline-block bg-orange-500 px-2 py-1 font-bold text-white">
          {money(cash.atPickup)}
          <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide">al retirar</span>
        </span>
      )}
    </div>
  );
}
