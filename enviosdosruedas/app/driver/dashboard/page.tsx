'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import QrScannerModal from '@/components/driver/QrScannerModal';
import { useEscaner } from '@/components/driver/DriverShell';
import Link from 'next/link';
import {
  ArrowUpDown,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GripVertical,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import ResolveDeliveryModal from '@/components/driver/ResolveDeliveryModal';
import ShipmentCard from '@/components/driver/ShipmentCard';
import ShipmentSheet from '@/components/driver/ShipmentSheet';
import { useToast } from '@/components/driver/Toast';
import {
  avisarPosicionSiCorresponde,
  avisarPosicionYa,
  seguirEnviando,
} from '@/lib/driver/posicion';
import {
  cacheRoute,
  dropBlocked,
  guardarOrden,
  leerOrden,
  listPending,
  readCachedRoute,
  type DeliveryKind,
} from '@/lib/driver/db';
import { errorText } from '@/lib/driver/errors';
import { marcarEstado, type EstadoIntermedio } from '@/lib/driver/status';
import { flushPending } from '@/lib/driver/sync';
import { ETIQUETA_ESTADO, money, shipmentCash, type Shipment } from '@/lib/format';
import { aplicarOrden, moverEncima, moverUno } from '@/lib/driver/orden';
import { hoyLocal, partirRuta } from '@/lib/scheduled';
import {
  conectarse,
  desconectarse,
  desdeCuando,
  leerTurno,
  turnoConocido,
  type Turno,
} from '@/lib/driver/turno';
import { falloDelGpsNativo } from '@/lib/driver/nativo';

/**
 * Todo lo que todavía tiene abierto, sin importar cómo llegó a su hoja de ruta.
 *
 * Antes esta lista arrancaba en 'retirado' y dejaba afuera 'creado' y
 * 'pendiente_retiro': los envíos que el admin le asignaba a mano desde el panel
 * nunca le aparecían al chofer, porque todavía no los había escaneado.
 * Los únicos que no van son los cerrados: 'entregado' y 'cancelado'.
 */
/** Trabajo por hacer: lo que todavía hay que mover. */
const ACTIVE_STATUSES = ['creado', 'pendiente_retiro', 'retirado', 'en_camino'];

/**
 * Terminados: se entregó, o se fue y no se pudo.
 *
 * "Pendiente de entrega" salió de la lista de trabajo a propósito. Es el envío
 * que ya se intentó: sigue existiendo y se puede mirar, pero volver a
 * intentarlo es una decisión del panel —ahí se reprograma para otro día— y no
 * algo que quede dando vueltas en la hoja de ruta.
 */
const CERRADOS = ['entregado', 'pendiente_entrega'];

function fetchRoute(driverId: string) {
  const hoy = hoyLocal();

  return (
    supabase
      .from('shipments')
      .select('*')
      .eq('assigned_driver', driverId)
      /*
       * Los reprogramados no van.
       *
       * Al reprogramar, el intento fallido se queda como registro del viaje y
       * nace un envío nuevo. Sin este filtro el repartidor veía los dos —el de
       * ayer y el de hoy, el mismo paquete— sin forma de saber cuál tocar, y
       * pasó lo que tenía que pasar: cerró el que no era.
       */
      .is('reprogramado_en', null)
      /*
       * Lo que hay que hacer, de cualquier fecha, MÁS lo que se cerró hoy.
       *
       * Lo cerrado se trae sólo del día: sirve para repasar la jornada y para
       * corregir un cierre equivocado, y traer el historial entero al celular
       * sería llenarlo de envíos de hace tres semanas.
       */
      .or(
        `status.in.(${ACTIVE_STATUSES.join(',')}),` +
          `and(scheduled_date.eq.${hoy},status.in.(${CERRADOS.join(',')}))`,
      )
      .order('id', { ascending: true })
  );
}

export default function DriverDashboardPage() {
  const router = useRouter();
  const toast = useToast();

  const [driver, setDriver] = useState<{ id: string; name: string } | null>(null);
  const [route, setRoute] = useState<Shipment[]>([]);
  /**
   * Si arrancó la jornada. Sin esto no se ve la ruta ni se registra posición.
   *
   * `null` es "todavía no sé", y es distinto de "desconectado". Arrancaba en
   * desconectado y eso le hacía afirmar algo falso durante el medio segundo que
   * tarda la consulta: cada vez que se cambiaba de pantalla aparecía "No estás
   * conectado" y después saltaba a la hoja de ruta.
   *
   * Se siembra con lo último que se supo, que sobrevive al cambio de pantalla
   * (ver `turnoConocido`). La primera vez del día no hay nada y ahí sí se
   * espera, mostrando que está cargando y no una suposición.
   */
  const [turno, setTurno] = useState<Turno | null>(() => turnoConocido());
  const [turnoOcupado, setTurnoOcupado] = useState(false);
  /** Si la lista de cerrados de hoy está desplegada. */
  const [verCerrados, setVerCerrados] = useState(false);
  /** El orden que eligió el repartidor, por id. Vacío = el que vino. */
  const [orden, setOrden] = useState<number[]>([]);
  const [modoOrden, setModoOrden] = useState(false);
  const [arrastrando, setArrastrando] = useState<number | null>(null);
  /**
   * La foto del orden al empezar a arrastrar.
   *
   * Es lo que hace que soltar dos veces —el navegador lo dispara más de una
   * vez— no corra la tarjeta de más. Ver `lib/driver/orden`.
   */
  const arrastreRef = useRef<{ id: number; base: number[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{
    /** Se siguen reintentando solas. */
    sendable: number;
    /** Trabadas: el servidor las rechazó definitivamente. */
    blocked: number;
    blockedCodes: string[];
    lastError: string | null;
  }>({ sendable: 0, blocked: 0, blockedCodes: [], lastError: null });

  /** El botón vive en la barra de abajo; acá se dibuja el lector. */
  const { abierto: escaneando, cerrar: cerrarEscaner } = useEscaner();

  /*
   * Al salir de la hoja de ruta, el lector se apaga.
   *
   * El estado vive en el shell —para que el botón de la barra lo pueda abrir
   * desde cualquier pantalla— pero el lector se dibuja acá. Sin esto, abrirlo,
   * volver atrás, pasar por otra sección y regresar lo mostraba abierto de
   * nuevo, sin que nadie lo hubiera pedido.
   */
  useEffect(() => cerrarEscaner, [cerrarEscaner]);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [resolving, setResolving] = useState<DeliveryKind | null>(null);

  // --- sesión ------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace('/login');
        return;
      }

      // El id alcanza para pedir la hoja de ruta. Antes se esperaba también el
      // nombre del perfil, y esa consulta de más retrasaba TODA la pantalla.
      setDriver({ id: user.id, name: '' });

      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data: profile }) =>
          setDriver((prev) => (prev ? { ...prev, name: profile?.full_name ?? '' } : prev)),
        );
    });
  }, [router]);

  /*
   * --- la conexión de la jornada (paso 37) -------------------------------
   *
   * Se relee cada tanto y no una sola vez al abrir, porque la conexión SE VENCE
   * SOLA a las dos horas sin actividad y de eso la app no se entera por su
   * cuenta. Sin releer, el repartidor vería "conectado" mientras el servidor ya
   * está descartando sus posiciones: la peor combinación posible, porque nadie
   * de los dos lados sabría que está pasando.
   */
  useEffect(() => {
    if (!driver) return;
    let vivo = true;

    const mirar = () => {
      void leerTurno(driver.id).then((t) => {
        if (!vivo) return;
        setTurno((antes) => {
          // Si se venció solo, hay que decirlo. Apagarse en silencio deja al
          // repartidor convencido de que estaba trabajando.
          if (antes?.conectado && !t.conectado) {
            toast('Se cerró tu jornada por inactividad. Volvé a conectarte si seguís.', 'warn');
          }
          return t;
        });
      });
    };

    mirar();
    const timer = window.setInterval(mirar, 60_000);

    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [driver, toast]);

  const alternarTurno = useCallback(async () => {
    setTurnoOcupado(true);
    try {
      if (turno?.conectado) {
        if (await desconectarse()) {
          setTurno({ conectado: false, desde: null });
          toast('Listo, te desconectaste. Dejamos de registrar tu ubicación.', 'ok');
        } else {
          toast('No se pudo desconectar. Fijate si tenés señal.', 'error');
        }
        return;
      }

      const nuevo = await conectarse();
      if (nuevo) {
        setTurno(nuevo);
        toast('Conectado. Ya podés ver tu hoja de ruta.', 'ok');
      } else {
        toast('No se pudo conectar. Fijate si tenés señal.', 'error');
      }
    } finally {
      setTurnoOcupado(false);
    }
  }, [turno?.conectado, toast]);

  // --- hoja de ruta ------------------------------------------------------
  useEffect(() => {
    if (!driver) return;
    let cancelled = false;
    let fromNetwork = false;

    // Primero lo que ya está en el celular: se ve al instante y funciona sin señal.
    readCachedRoute().then((rows) => {
      if (cancelled || fromNetwork || rows.length === 0) return;
      setRoute(rows);
      setLoading(false);
    });

    fetchRoute(driver.id).then(({ data, error }) => {
      if (cancelled) return;
      fromNetwork = true;
      if (error) {
        setLoading(false); // sin señal nos quedamos con lo cacheado
        return;
      }
      const rows = (data ?? []) as Shipment[];
      setRoute(rows);
      setLoading(false);
      // El caché copia EXACTAMENTE lo que contestó el servidor, incluso si es
      // una lista vacía: si no, los envíos borrados desde el panel seguían
      // apareciendo en el celular para siempre.
      cacheRoute(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [driver]);

  /** Vuelve a pedir la hoja de ruta sin recargar la página. */
  const recargar = useCallback(() => {
    if (!driver) return;
    // La app está en pantalla justo ahora: buen momento para refrescar dónde
    // anda. Ver `avisarPosicionSiCorresponde`.
    avisarPosicionSiCorresponde();
    setLoading(true);
    fetchRoute(driver.id).then(({ data, error }) => {
      setLoading(false);
      if (error) {
        toast('Sin señal: seguís viendo la última hoja de ruta guardada.', 'warn');
        return;
      }
      const rows = (data ?? []) as Shipment[];
      setRoute(rows);
      cacheRoute(rows);
    });
  }, [driver, toast]);

  // --- el orden que eligió el repartidor ---------------------------------
  useEffect(() => {
    let vivo = true;
    leerOrden().then((ids) => {
      if (vivo && ids.length) setOrden(ids);
    });
    return () => {
      vivo = false;
    };
  }, []);

  /** Guarda el orden nuevo, en la pantalla y en el celular. */
  const acomodar = useCallback((ids: number[]) => {
    setOrden(ids);
    void guardarOrden(ids);
  }, []);

  // --- cola offline ------------------------------------------------------
  const refreshPending = useCallback(() => {
    listPending().then((items) => {
      const blocked = items.filter((i) => i.blocked);
      setPending({
        sendable: items.length - blocked.length,
        blocked: blocked.length,
        blockedCodes: blocked.map((i) => i.trackingCode),
        // El último error anotado: si el servidor está rechazando algo,
        // que se vea acá en vez de decir "esperando señal" para siempre.
        lastError: items.map((i) => i.lastError).filter(Boolean).pop() ?? null,
      });
    });
  }, []);

  /** Tirar una entrega trabada es perder el comprobante: se pregunta primero. */
  const discardBlocked = useCallback(() => {
    const detalle = pending.blockedCodes.join(', ');
    const ok = confirm(
      `Estas ${pending.blocked} entrega(s) no se pueden enviar:\n\n${detalle}\n\n` +
        `${pending.lastError ?? ''}\n\n` +
        'Si las descartás se borran del celular y no quedan registradas. ¿Seguimos?',
    );
    if (!ok) return;
    dropBlocked().then((n) => {
      refreshPending();
      toast(`Se descartaron ${n} entrega(s).`, 'info');
    });
  }, [pending, refreshPending, toast]);

  useEffect(() => {
    refreshPending();
    const timer = window.setInterval(refreshPending, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshPending]);

  /**
   * Mientras esté conectado, avisar por dónde va.
   *
   * ANTES ERA "mientras le quede trabajo del día", y eso dejaba ciega a la
   * oficina justo en el caso más útil: el repartidor libre, que es al que le
   * querés dar el próximo retiro. Desde el paso 37 lo decide él con el botón, y
   * la base aplica la misma regla al guardar.
   *
   * El efecto se rearma cuando cambia la conexión: al desconectarse hay que
   * cortar el seguimiento de verdad —que se apague el aviso fijo de Android— y
   * no sólo dejar de mandar.
   */
  const conectadoRef = useRef(false);
  useEffect(() => {
    conectadoRef.current = turno?.conectado === true;
  }, [turno?.conectado]);

  /**
   * La hoja de ruta por referencia, para el guardia del escáner.
   *
   * Se lee así y no como dependencia porque el escaneo tiene que ver la ruta
   * de AHORA sin que su función se rearme con cada cambio de la lista.
   */
  const rutaRef = useRef(route);
  useEffect(() => {
    rutaRef.current = route;
  }, [route]);

  useEffect(() => {
    if (!turno?.conectado) return;
    const cortar = seguirEnviando(() => conectadoRef.current);

    /*
     * Si el GPS de la app no arrancó, DECIRLO.
     *
     * Esto existe por una tarde entera perdida: el servicio no arrancaba, la
     * app se veía impecable, no mandaba una sola posición y no había forma de
     * saber por qué. Se probó el permiso, la batería del fabricante y el
     * plugin, a ciegas, porque el error se descartaba en silencio.
     *
     * Se espera unos segundos porque arrancar incluye pedir permisos, y
     * preguntar antes daría siempre un falso positivo.
     */
    const revisar = window.setTimeout(() => {
      const fallo = falloDelGpsNativo();
      if (fallo) {
        toast(`No se pudo activar el GPS: ${fallo}. Avisá a la oficina.`, 'error');
      }
    }, 8_000);

    return () => {
      window.clearTimeout(revisar);
      cortar();
    };
  }, [turno?.conectado, toast]);

  // --- escaneo -----------------------------------------------------------
  const handleDetected = useCallback(
    async (code: string) => {
      cerrarEscaner();

      /*
       * Si ya lo tenía, no se vuelve a escanear.
       *
       * Pasa todo el tiempo: se escanea de nuevo por las dudas, o porque el
       * paquete se movió de bolso. Y no era inofensivo. El escaneo asigna y
       * pone "en camino", y la app inmediatamente después lo pasa a
       * "retirado": un envío que YA había salido volvía para atrás, y uno con
       * un intento fallido perdía ese estado y aparecía como si nunca hubiera
       * pasado nada. También quedaba un movimiento de retiro repetido en el
       * historial del envío.
       *
       * La ruta son justamente los envíos que este repartidor tiene, así que
       * alcanza con mirar ahí. Va antes que el aviso de "sin señal" porque
       * contestar esto no necesita internet.
       */
      const buscado = code.trim().toUpperCase();
      const yaEsMio = rutaRef.current.find(
        (s) => String(s.id) === buscado || s.tracking_code?.toUpperCase() === buscado,
      );

      if (yaEsMio) {
        toast(
          `Ya lo tenés: ${yaEsMio.address_street} · ${ETIQUETA_ESTADO[yaEsMio.status]}.`,
          'warn',
        );
        return;
      }

      if (!navigator.onLine) {
        toast('Sin señal: para sumar un paquete hace falta internet.', 'error');
        return;
      }

      avisarPosicionSiCorresponde();

      const { data, error } = await supabase.rpc('scan_and_assign', { p_code: code });

      if (error) {
        console.error('[escaneo] scan_and_assign falló', { code: error.code, message: error.message });
        // "Ya lo tenés" no es un error: es que no hay nada que hacer. En rojo
        // parece que algo salió mal y lo manda a llamar a la oficina.
        toast(errorText(error.message), error.message.includes('YA_LO_TENES') ? 'warn' : 'error');
        return;
      }

      // Escanear significa que el paquete ya está en la moto: queda "retirado".
      // El paso a "en camino" lo marca él cuando arranca el reparto.
      const escaneado = data as Shipment;
      const { shipment: actualizado } = await marcarEstado(escaneado.id, 'retirado');
      const shipment = actualizado ?? escaneado;

      setRoute((prev) =>
        prev.some((s) => s.id === shipment.id)
          ? prev.map((s) => (s.id === shipment.id ? shipment : s))
          : [shipment, ...prev],
      );
      toast(`Retirado: ${shipment.address_street}`, 'ok');
    },
    [toast, cerrarEscaner],
  );

  /** Marca retirado / en camino y refleja el cambio en la lista al instante. */
  const cambiarEstado = useCallback(
    async (s: Shipment, estado: EstadoIntermedio) => {
      const { shipment, error } = await marcarEstado(s.id, estado);
      if (error || !shipment) {
        toast(error ?? 'No se pudo cambiar el estado.', 'error');
        return;
      }
      setRoute((prev) => prev.map((x) => (x.id === shipment.id ? shipment : x)));
      setSelected((prev) => (prev && prev.id === shipment.id ? shipment : prev));

      // Salir en camino es el momento exacto en que el que espera empieza a
      // mirar el seguimiento: la primera posición se manda ahora y no en el
      // próximo tic del reloj, que puede tardar dos minutos. Retirar también
      // deja rastro, con el espaciado de siempre: es otro momento en que la app
      // está en pantalla, y esos son los únicos que sirven.
      if (estado === 'en_camino') avisarPosicionYa();
      else avisarPosicionSiCorresponde();

      toast(estado === 'retirado' ? 'Marcado como retirado.' : 'Marcado en camino.', 'ok');
    },
    // `setSelected` va en la lista aunque sea estable: el compilador de React
    // no da por buena la memorizacion si no coinciden, y sin eso deja de
    // optimizar toda la pantalla.
    [toast, setSelected],
  );

  // --- cierre de entrega -------------------------------------------------
  function handleResolved(shipmentId: number, kind: DeliveryKind) {
    avisarPosicionSiCorresponde();
    // No se borra de la lista: pasa a "cerrados hoy". Se cambia acá y no
    // pidiendo la hoja de ruta de nuevo porque esto tiene que funcionar sin
    // señal, que es cuando más se usa.
    setRoute((prev) =>
      prev.map((s) =>
        s.id === shipmentId
          ? ({ ...s, status: kind === 'entregado' ? 'entregado' : 'pendiente_entrega' } as Shipment)
          : s,
      ),
    );
    setSelected(null);
    setResolving(null);
    refreshPending();
  }

  const { deHoy, proximos } = partirRuta(route);

  /** Lo que falta hacer, que es de lo que se trata la pantalla. */
  const pendientes = aplicarOrden(
    deHoy.filter((s) => !CERRADOS.includes(s.status)),
    orden,
  );
  /** Lo de hoy que ya terminó, para repasar o corregir. */
  const cerrados = deHoy.filter((s) => CERRADOS.includes(s.status));

  // El total del día no cuenta lo que todavía no se reparte: si lo sumara, el
  // repartidor rendiría de más y el cierre de caja no daría. Tampoco lo ya
  // entregado, por el mismo motivo: es plata que ya tiene en el bolsillo.
  const totalCash = pendientes.reduce((acc, s) => acc + shipmentCash(s).total, 0);

  /* Lo hecho sobre lo del día: es el número que el repartidor mira para saber
     cuánto le falta, y el que hace que la barra de progreso signifique algo. */
  const hechos = cerrados.length;
  const total = deHoy.length;
  const avance = total > 0 ? Math.round((hechos / total) * 100) : 0;

  /*
   * DESCONECTADO NO SE VE LA RUTA, y eso no es una traba: es lo que hace que
   * olvidarse de conectarse no cueste nada. El repartidor abre, no ve sus
   * envíos, toca el botón. Se corrige solo en el primer segundo, sin que nadie
   * tenga que acordarse de nada ni llamarlo por teléfono.
   */
  // Todavía no se sabe: no se dibuja ni la ruta ni el cartel de desconectado.
  // Afirmar cualquiera de las dos cosas sin saberla es peor que esperar.
  if (turno === null) {
    return (
      <p className="px-3.5 py-10 text-center font-bebas text-base tracking-[.06em] text-[var(--edr-muted)]">
        CARGANDO…
      </p>
    );
  }

  if (!turno.conectado) {
    return <Desconectado ocupado={turnoOcupado} onConectar={alternarTurno} />;
  }

  return (
    <div className="flex flex-col gap-3.5 px-3.5 pb-6 pt-4">
      {/* ---------- Encabezado ---------- */}
      <header className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2.5">
          <h1 className="font-anton text-[26px] uppercase leading-none tracking-[-.02em] text-white">
            Hoja de ruta
          </h1>
          <span className="edr-mono text-[15px] font-bold text-[var(--edr-yellow)]">
            {hechos}/{total}
          </span>
        </div>

        {/* La barra dice de un vistazo cuánto queda, que es lo que se pregunta
            veinte veces por día. */}
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[var(--edr-yellow)] transition-[width] duration-300 ease-[var(--edr-smooth)]"
            style={{ width: `${avance}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="font-bebas text-base tracking-[.06em] text-[var(--edr-muted)]">
            {pendientes.length} POR HACER
            {proximos.length > 0 && ` · ${proximos.length} PARA DESPUÉS`}
          </span>

          {pendientes.length > 1 && (
            <button
              onClick={() => setModoOrden((v) => !v)}
              className={`ml-auto flex items-center gap-1.5 rounded-full border border-[var(--edr-yellow)] px-3.5 py-2 font-bebas text-sm tracking-[.06em] transition active:scale-95 ${
                modoOrden
                  ? 'bg-[var(--edr-yellow)] text-[var(--edr-blue)]'
                  : 'text-[var(--edr-yellow)]'
              }`}
            >
              {modoOrden ? <Check size={16} strokeWidth={2.5} /> : <ArrowUpDown size={16} strokeWidth={2} />}
              {modoOrden ? 'LISTO' : 'REORDENAR'}
            </button>
          )}
          {/* Actualiza los datos SIN recargar la página: una recarga volvería a
              disparar el pedido de permisos de cámara y GPS. */}
          <button
            onClick={() => {
              recargar();
              refreshPending();
            }}
            aria-label="Actualizar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 text-[var(--edr-muted)] transition active:scale-95"
          >
            <RefreshCw size={18} strokeWidth={2} />
          </button>
        </div>

        {totalCash > 0 && (
          <Link
            href="/driver/caja"
            className="flex items-center justify-between gap-3 rounded-full bg-[var(--edr-yellow)] px-5 py-3 text-[var(--edr-blue)] shadow-[var(--edr-sombra)] transition active:scale-95"
          >
            <span className="font-bebas text-[17px] tracking-[.1em]">A COBRAR HOY</span>
            <span className="flex items-center gap-1">
              <span className="edr-mono text-[22px] font-extrabold tracking-[-.03em]">
                {money(totalCash)}
              </span>
              <ChevronRight size={18} strokeWidth={2.5} />
            </span>
          </Link>
        )}

        {/* En camino: se reintentan solas, sólo hay que esperar. */}
        {pending.sendable > 0 && (
          <button
            onClick={() =>
              flushPending().then((outcome) => {
                refreshPending();
                if (outcome.sent > 0) toast(`Se enviaron ${outcome.sent} entrega(s).`, 'ok');
                else if (outcome.blocked > 0)
                  toast(outcome.lastServerError ?? 'Quedaron trabadas.', 'error');
                else if (outcome.serverFailures > 0)
                  toast(`El servidor las rechaza: ${outcome.lastServerError}`, 'error');
                else if (outcome.networkFailures > 0)
                  toast('Todavía no hay señal para enviarlas.', 'warn');
              })
            }
            className="w-full rounded-2xl bg-[var(--edr-yellow)] px-4 py-3 text-center font-bebas text-base tracking-[.06em] text-[var(--edr-blue)]"
          >
            {pending.sendable} entrega(s) sin enviar · tocá para reintentar
            {pending.lastError && (
              <span className="mt-1 block text-xs font-semibold opacity-90">
                {pending.lastError}
              </span>
            )}
          </button>
        )}

        {/* Trabadas: reintentar no sirve, hay que decidir qué hacer con ellas. */}
        {pending.blocked > 0 && (
          <button
            onClick={discardBlocked}
            className="w-full rounded-2xl bg-[var(--edr-rojo)] px-4 py-3 text-center font-bebas text-base tracking-[.06em] text-white"
          >
            {pending.blocked} entrega(s) no se pueden enviar · tocá para descartar
            <span className="mt-1 block text-xs font-semibold opacity-90">
              {pending.lastError}
            </span>
          </button>
        )}

        {/* Terminar la jornada.
            Va acá abajo y no arriba a propósito: se toca una vez por día, al
            final, y no tiene que competir por el pulgar con los botones que se
            usan veinte veces. Pero tiene que estar a la vista en esta pantalla:
            escondido en Perfil, nadie se desconectaría nunca. */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2.5">
          <span className="font-bebas text-sm tracking-[.06em] text-[var(--edr-verde-claro)]">
            CONECTADO {desdeCuando(turno).toUpperCase()}
          </span>
          <button
            onClick={alternarTurno}
            disabled={turnoOcupado}
            className="rounded-full border border-white/25 px-3.5 py-2 font-bebas text-sm tracking-[.06em] text-[var(--edr-muted)] transition active:scale-95 disabled:opacity-50"
          >
            {turnoOcupado ? 'ESPERÁ…' : 'DESCONECTARME'}
          </button>
        </div>
      </header>

      {/* ---------- Hoja de ruta ---------- */}
      <main className="flex flex-col gap-3.5">
        {loading && (
          <p className="py-10 text-center text-base font-semibold text-[var(--edr-muted)]">
            Cargando tu hoja de ruta…
          </p>
        )}

        {!loading && route.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-6 py-12 text-center">
            <p className="text-xl font-black">No tenés paquetes todavía</p>
            <p className="mt-1 text-base text-[var(--edr-muted)]">
              Escaneá el QR de cada etiqueta al cargar la moto.
            </p>
          </div>
        )}

        {!loading && pendientes.length === 0 && proximos.length > 0 && (
          <div className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-6 py-8 text-center">
            <p className="text-xl font-black">Por hoy no te queda nada</p>
            <p className="mt-1 text-base text-[var(--edr-muted)]">
              Abajo están los que ya te cargaron para los próximos días.
            </p>
          </div>
        )}

        {modoOrden ? (
          <>
            <p className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-4 py-3 text-sm font-semibold text-[var(--edr-muted)]">
              Arrastrá las filas para armar tu recorrido, o usá las flechas si estás con guantes.
              El orden queda guardado en este celular.
            </p>

            {pendientes.map((s, i) => (
              <div
                key={s.id}
                draggable
                onDragStart={(e) => {
                  // La foto del orden al empezar: la cuenta del soltar se hace
                  // siempre contra esto. Ver `lib/driver/orden`.
                  arrastreRef.current = { id: s.id, base: pendientes.map((x) => x.id) };
                  e.dataTransfer.effectAllowed = 'move';
                  setArrastrando(s.id);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const d = arrastreRef.current;
                  if (d && d.id !== s.id) acomodar(moverEncima(d.base, d.id, s.id));
                  setArrastrando(null);
                }}
                onDragEnd={() => {
                  arrastreRef.current = null;
                  setArrastrando(null);
                }}
                className={`flex items-center gap-2.5 rounded-2xl border bg-[var(--edr-blue)] p-2.5 ${
                  arrastrando === s.id
                    ? 'border-[var(--edr-yellow)] opacity-50'
                    : 'border-white/10'
                }`}
              >
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-white/10 text-[var(--edr-muted)]">
                  <GripVertical size={18} strokeWidth={2} />
                </span>

                <span className="edr-mono w-5 shrink-0 text-sm font-bold text-[var(--edr-yellow)]">
                  {i + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-anton text-xl uppercase leading-tight text-white">
                    {s.address_street}
                  </span>
                  <span className="block truncate text-[12.5px] text-[var(--edr-muted)]">
                    {ETIQUETA_ESTADO[s.status]}
                    {shipmentCash(s).total > 0 && ` · cobrar ${money(shipmentCash(s).total)}`}
                  </span>
                </span>

                <button
                  onClick={() => acomodar(moverUno(pendientes.map((x) => x.id), s.id, -1))}
                  disabled={i === 0}
                  aria-label="Subir"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 text-white transition active:scale-95 disabled:opacity-30"
                >
                  <ChevronUp size={20} strokeWidth={2.5} />
                </button>
                <button
                  onClick={() => acomodar(moverUno(pendientes.map((x) => x.id), s.id, 1))}
                  disabled={i === pendientes.length - 1}
                  aria-label="Bajar"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-white/15 text-white transition active:scale-95 disabled:opacity-30"
                >
                  <ChevronDown size={20} strokeWidth={2.5} />
                </button>
              </div>
            ))}

            <button
              onClick={() => setModoOrden(false)}
              className="mt-1 flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-[var(--edr-yellow)] font-bebas text-xl tracking-[.06em] text-[var(--edr-blue)] transition active:scale-95"
            >
              <Check size={20} strokeWidth={2.5} />
              LISTO, ASÍ VOY
            </button>
          </>
        ) : (
          pendientes.map((s) => (
            <ShipmentCard
              key={s.id}
              shipment={s}
              onOpen={setSelected}
              onEstado={cambiarEstado}
              onCerrarEntrega={(x) => {
                setSelected(x);
                setResolving('entregado');
              }}
            />
          ))
        )}

        {/* Cerrados de hoy. Plegado, porque no es trabajo: es para repasar la
            jornada, o para entrar a uno que se cerró mal y corregirlo. */}
        {cerrados.length > 0 && (
          <div className="mt-1 overflow-hidden rounded-2xl border border-white/10">
            <button
              onClick={() => setVerCerrados((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
            >
              <span>
                <span className="font-bebas text-base tracking-[.08em] text-white">
                  CERRADOS HOY · {cerrados.length}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--edr-muted)]">
                  {cerrados.filter((s) => s.status === 'entregado').length} entregados ·{' '}
                  {cerrados.filter((s) => s.status === 'pendiente_entrega').length} sin entregar
                </span>
              </span>
              {verCerrados ? (
                <ChevronUp size={20} strokeWidth={2} className="shrink-0 text-[var(--edr-muted)]" />
              ) : (
                <ChevronDown size={20} strokeWidth={2} className="shrink-0 text-[var(--edr-muted)]" />
              )}
            </button>

            {/* Filas compactas y no tarjetas: acá no hay nada que hacer, sólo
                mirar. Entrando se corrige uno que se cerró mal. */}
            {verCerrados &&
              cerrados.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className="flex w-full items-center gap-3 border-t border-white/10 px-4 py-3 text-left"
                >
                  {s.status === 'entregado' ? (
                    <CheckCircle2 size={20} strokeWidth={2} className="shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle size={20} strokeWidth={2} className="shrink-0 text-red-400" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-anton text-lg uppercase leading-tight text-white">
                      {s.address_street}
                    </span>
                    <span className="block truncate text-xs text-[var(--edr-muted)]">
                      {s.recipient_name} · {ETIQUETA_ESTADO[s.status]}
                    </span>
                  </span>
                </button>
              ))}
          </div>
        )}

        {/* Programados: se ven para poder organizarse, pero no se tocan hasta
            el día. El candado real está en la base (paso 14). */}
        {proximos.length > 0 && (
          <>
            <h2 className="px-1 pt-2 font-bebas text-base tracking-[.08em] text-[var(--edr-muted)]">
              PRÓXIMOS DÍAS · {proximos.length}
            </h2>
            {proximos.map((s) => (
              <ShipmentCard key={s.id} shipment={s} onOpen={setSelected} onEstado={cambiarEstado} />
            ))}
          </>
        )}
      </main>

      {/* ---------- Capas ---------- */}
      {escaneando && (
        <QrScannerModal onDetected={handleDetected} onClose={cerrarEscaner} />
      )}

      {selected && !resolving && (
        <ShipmentSheet
          shipment={selected}
          onClose={() => setSelected(null)}
          onResolve={setResolving}
          onEstado={cambiarEstado}
        />
      )}

      {selected && resolving && (
        <ResolveDeliveryModal
          shipment={selected}
          kind={resolving}
          onClose={() => setResolving(null)}
          onResolved={handleResolved}
          onSynced={refreshPending}
        />
      )}
    </div>
  );
}

/**
 * La pantalla de antes de arrancar.
 *
 * Ocupa todo y tiene un solo botón a propósito. Es lo primero que ve el
 * repartidor cada mañana y lo último que quiere es leer: un botón grande, del
 * tamaño de un pulgar con guante, y nada más que decidir.
 *
 * El texto de abajo no es relleno. Es la única parte del sistema donde se le
 * dice, en una línea y con sus palabras, qué se registra y hasta cuándo. Eso no
 * puede vivir sólo en un archivo de SQL que él nunca va a leer.
 */
function Desconectado({ ocupado, onConectar }: { ocupado: boolean; onConectar: () => void }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 px-6 py-10 text-center">
      <div>
        <h1 className="font-anton text-[28px] uppercase leading-none tracking-[-.02em] text-white">
          No estás conectado
        </h1>
        <p className="mt-2 font-bebas text-base tracking-[.06em] text-[var(--edr-muted)]">
          CONECTATE PARA VER TU HOJA DE RUTA
        </p>
      </div>

      <button
        onClick={onConectar}
        disabled={ocupado}
        className="w-full max-w-xs rounded-2xl bg-[var(--edr-yellow)] px-6 py-6 font-anton text-2xl uppercase tracking-[-.01em] text-[var(--edr-blue)] transition active:scale-95 disabled:opacity-60"
      >
        {ocupado ? 'Conectando…' : 'Conectarme'}
      </button>

      <p className="max-w-xs text-sm leading-relaxed text-[var(--edr-muted)]">
        Mientras estés conectado, la oficina ve dónde estás para poder darte los
        retiros más cercanos. Se corta cuando te desconectás, y solo a las dos
        horas sin actividad.
      </p>
    </div>
  );
}
