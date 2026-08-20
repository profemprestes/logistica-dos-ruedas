'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { dayShift, today } from '@/lib/settlement';
import {
  marcaDeEstado,
  nombreDelDestinatario,
  STATUS_LABEL,
  money,
  shipmentCash,
  type Shipment,
  type ShipmentStatus,
} from '@/lib/format';
import type { PuntoMapa } from '@/components/MapaEnvios';
import { comoSeLlama, conHermanos, type Puestos } from '@/lib/entregas';

/** Leaflet toca `window` al cargar: nunca en el servidor. */
const MapaEnvios = dynamic(() => import('@/components/MapaEnvios'), {
  ssr: false,
  loading: () => (
    <div className="edr-mapa flex items-center justify-center rounded-lg border border-dashed border-[var(--edr-border)] text-sm text-[var(--edr-muted)]">
      Abriendo el mapa…
    </div>
  ),
});

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

interface Driver {
  id: string;
  full_name: string;
}

/**
 * Qué está pasando con ese repartidor. Son tres cosas distintas y antes se
 * mostraban las tres como "última señal hace tanto".
 *
 *  - `moviendose`: llegan posiciones y cambian de lugar. Está repartiendo.
 *  - `parado`: llegan posiciones y son todas del mismo lado. Está en un
 *    comercio, almorzando o esperando que le abran. LA APP ANDA.
 *  - `sin-senal`: dejaron de llegar y ÉL SIGUE CONECTADO. Sin señal, sin
 *    batería, o se cerró la app. Es el único que pide levantar el teléfono.
 *  - `desconectado`: terminó su jornada, o todavía no la empezó. El punto que
 *    se ve es de dónde estaba la última vez, y no significa nada más.
 *
 * Las tres últimas se veían iguales —"última señal hace tanto"— y son cosas
 * completamente distintas: dos no requieren hacer nada y una es una urgencia.
 */
type EstadoRepartidor = 'moviendose' | 'parado' | 'sin-senal' | 'desconectado';

/** Dónde se lo vio por última vez, y por qué. */
interface Repartidor {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  haceMinutos: number;
  /** La hora de esa última señal, que es lo que se lee de un vistazo. */
  hora: string;
  /** De dónde salió el punto: le cambia el sentido a lo que se está mirando. */
  origen: 'app' | 'entrega';
  estado: EstadoRepartidor;
  /** Si está parado, desde hace cuánto. Es el dato que se mira para decidir. */
  quietoDesdeMin: number;
  /** Si se acabaron las posiciones guardadas antes de encontrar cuándo llegó. */
  quietoDesdeHaceMas: boolean;
}

/**
 * Cuánto silencio hace falta para decir "sin señal".
 *
 * Tiene que ser bastante más que el latido de la app (ver `LATIDO_MS` en
 * `lib/driver/posicion.ts`): que se pierda un latido por una antena saturada no
 * es quedarse sin señal. Cinco minutos son varios latidos seguidos.
 *
 * OJO SI SE CAMBIA EL LATIDO: este número tiene que seguirlo. Con un latido de
 * dos minutos, cinco es apenas dos fallas y va a dar falsas alarmas.
 *
 * Y los que entran desde un navegador —Chrome, un iPhone— van a caer acá
 * seguido, porque ahí la posición se manda sólo con la app en pantalla. En su
 * caso "sin señal" es la verdad: el sistema no sabe dónde están.
 */
const MINUTOS_SIN_SENAL = 5;

/**
 * Cuánto se puede mover algo que está quieto.
 *
 * El GPS de un celular tiembla. Con quince o veinte metros de precisión, dos
 * lecturas del mismo lugar pueden estar a cuarenta metros una de otra sin que
 * nadie se haya movido. Ochenta da margen sin llegar a tapar media cuadra.
 */
const METROS_QUIETO = 80;

/** Sobre cuánto rato se mira si se movió o no. */
const VENTANA_QUIETO_MIN = 6;

/** Distancia rápida entre dos puntos, en metros. Alcanza y sobra para esto. */
function metrosEntre(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * El día entero sobre el mapa.
 *
 * Sirve para algo que la tabla no muestra: si el reparto está apelotonado en
 * una zona o desparramado por toda la ciudad, y qué le queda pendiente a cada
 * repartidor y dónde.
 */
export default function MapaAdminPage() {
  const ready = useAdminGuard();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [desde, setDesde] = useState(today);
  const [hasta, setHasta] = useState(today);
  const [soloPendientes, setSoloPendientes] = useState(false);

  const [envios, setEnvios] = useState<Shipment[]>([]);
  /** Los que son una de varias entregas del mismo envío (paso 53). */
  const [puestos, setPuestos] = useState<Puestos>(new Map());
  const [enCalle, setEnCalle] = useState<Repartidor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [elegido, setElegido] = useState<Shipment | null>(null);
  /** Los envíos que esperan en un mismo comercio, cuando se toca su punto. */
  const [enElComercio, setEnElComercio] = useState<Ubicado[] | null>(null);

  useEffect(() => {
    if (!ready) return;
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'repartidor')
      .order('full_name')
      .then(({ data }) => setDrivers((data ?? []) as Driver[]));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    // Los puntos de antes se quedan en pantalla hasta que llegan los nuevos:
    // vaciarlos primero hace parpadear el mapa en cada cambio de filtro.
    let q = supabase
      .from('shipments')
      // El comercio trae el punto de RETIRO, que el envío no tiene: guarda una
      // sola coordenada y es la de la entrega.
      .select('*, driver:assigned_driver(full_name), comercio:client_id(name, lat, lng)')
      .gte('scheduled_date', desde <= hasta ? desde : hasta)
      .lte('scheduled_date', desde <= hasta ? hasta : desde);

    if (driverId) q = q.eq('assigned_driver', driverId);

    q.then(({ data, error: dbError }) => {
      if (!vivo) return;
      if (dbError) setError(dbError.message);
      else {
        setEnvios((data ?? []) as Shipment[]);
        setError('');
      }
      setCargando(false);
    });

    return () => {
      vivo = false;
    };
  }, [ready, desde, hasta, driverId]);

  /**
   * Dónde anda cada repartidor conectado.
   *
   * Sale de las posiciones que manda la app, las mismas del seguimiento
   * público. Con una diferencia importante: acá va la posición EXACTA, no la
   * zona de 500 metros. Afuera se aproxima porque el link lo abre cualquiera;
   * adentro, coordinar el reparto necesita saber dónde está la moto.
   *
   * Se refresca solo: un mapa de flota que hay que recargar a mano no sirve
   * para mirar mientras se trabaja.
   */
  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    /*
     * DOS FUENTES, y la segunda es la que hace que esto sirva.
     *
     * Una son las posiciones que manda la app sola. La otra son las entregas
     * cerradas: cada vez que el repartidor cierra un envío, la app toma el GPS
     * y lo guarda con el movimiento. Esa segunda fuente venía existiendo desde
     * el principio y el mapa no la miraba, así que un repartidor que entregó
     * hace diez minutos aparecía como sin señal desde hacía una hora.
     *
     * Encima es MEJOR: el punto de una entrega se toma con el celular en la
     * mano y viene con dos metros de precisión, contra los quince o treinta
     * del envío automático. Y no depende de que la app esté en pantalla en el
     * momento justo: si cerró una entrega, hay punto.
     *
     * Gana la más nueva de las dos.
     */
    const traer = async () => {
      const desdeHoy = `${today()}T00:00:00`;

      const [posiciones, entregas] = await Promise.all([
        // La tabla se limpia sola a las tres horas: lo que hay es del día.
        supabase
          .from('driver_positions')
          .select('driver_id, lat, lng, taken_at, perfil:driver_id(full_name)')
          /*
           * No alcanza con la última: para saber si se movió hay que comparar
           * contra las de hace un rato, y para decir HACE CUÁNTO que está
           * parado hay que llegar hasta la posición en que llegó.
           *
           * 1200 son todas: la tabla se borra sola a las tres horas, y con el
           * latido de 30 segundos y tres repartidores no puede haber más de
           * unas mil. Con 600 la cuenta se cortaba a la mitad y un repartidor
           * parado hace dos horas figuraba parado hace cuarenta minutos.
           */
          .order('taken_at', { ascending: false })
          .limit(1200),
        supabase
          .from('delivery_logs')
          .select('driver_id, lat, lng, happened_at, perfil:driver_id(full_name)')
          .not('lat', 'is', null)
          .gte('happened_at', new Date(desdeHoy).toISOString())
          .order('happened_at', { ascending: false })
          .limit(200),
      ]);

      if (!vivo) return;

      /*
       * Quién está conectado AHORA. Se le pregunta a la base con la misma
       * función que usa el celular (`esta_conectado`, paso 37) en vez de mirar
       * `conectado_desde` y sacar la cuenta acá.
       *
       * Es a propósito: la conexión se vence sola a las dos horas, y si esa
       * cuenta viviera en dos lugares terminarían diciendo cosas distintas. El
       * panel mostraría "conectado" mientras el servidor descarta posiciones, y
       * nadie entendería por qué.
       */
      const conectados = new Set<string>();
      await Promise.all(
        (drivers.length ? drivers : []).map(async (d) => {
          const { data: vale } = await supabase.rpc('esta_conectado', { p_driver: d.id });
          if (vale === true) conectados.add(d.id);
        }),
      );

      if (!vivo) return;

      const candidatos: (Repartidor & { cuando: number })[] = [];

      const sumar = (
        driverId: string,
        nombre: string,
        lat: number,
        lng: number,
        cuando: string,
        origen: 'app' | 'entrega',
      ) => {
        const t = new Date(cuando).getTime();
        candidatos.push({
          id: driverId,
          nombre,
          lat: Number(lat),
          lng: Number(lng),
          cuando: t,
          haceMinutos: Math.max(0, Math.round((Date.now() - t) / 60_000)),
          hora: new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
          origen,
          // Se completan más abajo, cuando ya está toda la historia junta.
          estado: 'moviendose',
          quietoDesdeMin: 0,
          quietoDesdeHaceMas: false,
        });
      };

      /** Toda la historia de cada uno, de la más nueva a la más vieja. */
      const historia = new Map<string, { ms: number; lat: number; lng: number }[]>();

      type Fila = {
        driver_id: string;
        lat: number;
        lng: number;
        perfil: { full_name: string } | null;
      };

      for (const p of (posiciones.data ?? []) as unknown as (Fila & { taken_at: string })[]) {
        sumar(p.driver_id, p.perfil?.full_name ?? 'Repartidor', p.lat, p.lng, p.taken_at, 'app');

        const previas = historia.get(p.driver_id) ?? [];
        previas.push({ ms: new Date(p.taken_at).getTime(), lat: Number(p.lat), lng: Number(p.lng) });
        historia.set(p.driver_id, previas);
      }

      for (const l of (entregas.data ?? []) as unknown as (Fila & { happened_at: string })[]) {
        if (!l.driver_id) continue;
        sumar(
          l.driver_id,
          l.perfil?.full_name ?? 'Repartidor',
          l.lat,
          l.lng,
          l.happened_at,
          'entrega',
        );
      }

      // Una por repartidor: la más nueva, venga de donde venga.
      const ultima = new Map<string, Repartidor & { cuando: number }>();
      for (const c of candidatos) {
        const previa = ultima.get(c.id);
        if (!previa || c.cuando > previa.cuando) ultima.set(c.id, c);
      }

      /*
       * PARADO NO ES LO MISMO QUE SIN SEÑAL, y hasta ahora se veían igual.
       *
       * Sin señal es "no sé dónde está": hay que llamarlo. Parado es "sé
       * exactamente dónde está y hace cuánto que no se mueve": puede ser un
       * comercio que tarda, puede ser el almuerzo, y casi siempre no hay nada
       * que hacer. Mostrarlos con el mismo cartel obliga a averiguar de nuevo
       * cada vez, y a la larga se deja de mirar.
       */
      for (const r of ultima.values()) {
        /*
         * Desconectado gana sobre todo lo demás. Un repartidor que terminó su
         * jornada a las seis va a seguir teniendo su última posición guardada
         * hasta tres horas después, y sin esto aparecería toda la tarde como
         * "sin señal" —o sea, como una urgencia— cuando está en su casa.
         */
        if (!conectados.has(r.id)) {
          r.estado = 'desconectado';
          continue;
        }

        if (r.haceMinutos >= MINUTOS_SIN_SENAL) {
          r.estado = 'sin-senal';
          continue;
        }

        const suyas = historia.get(r.id) ?? [];
        const corte = Date.now() - VENTANA_QUIETO_MIN * 60_000;
        const enLaVentana = suyas.filter((p) => p.ms >= corte);

        /*
         * Con una sola posición en la ventana no se puede decir nada: recién
         * apareció. Se lo deja como en movimiento, que es lo que menos asusta.
         */
        if (enLaVentana.length < 2) {
          r.estado = 'moviendose';
          continue;
        }

        const masLejos = Math.max(...enLaVentana.map((p) => metrosEntre(r, p)));

        if (masLejos <= METROS_QUIETO) {
          r.estado = 'parado';

          /*
           * CUÁNTO HACE QUE ESTÁ AHÍ SE MIRA EN TODA LA HISTORIA, no en la
           * ventana.
           *
           * La ventana decide SI está parado. Usarla también para decir hace
           * cuánto era contestar siempre lo mismo: el techo de la ventana. Con
           * seis minutos, un repartidor parado hace dos horas figuraba "parado
           * hace 6 min" — y quien mira el panel concluye que recién llegó y no
           * hay nada que preguntar.
           *
           * Se camina hacia atrás desde la más nueva mientras sigan cerca. La
           * primera que se aleja corta: ahí llegó.
           */
          let desde = enLaVentana[enLaVentana.length - 1].ms;
          let seNosAcabo = true;

          for (const p of suyas) {
            if (metrosEntre(r, p) > METROS_QUIETO) {
              seNosAcabo = false;
              break;
            }
            desde = p.ms;
          }

          r.quietoDesdeMin = Math.max(1, Math.round((Date.now() - desde) / 60_000));

          /*
           * Se acabaron las posiciones sin encontrar el momento en que llegó:
           * o sea que hace MÁS que eso, y no sabemos cuánto. Pasa porque las
           * posiciones se borran solas a las tres horas.
           */
          r.quietoDesdeHaceMas = seNosAcabo;
        } else {
          r.estado = 'moviendose';
        }
      }

      setEnCalle([...ultima.values()]);
    };

    void traer();
    const timer = window.setInterval(() => void traer(), 60_000);

    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
    // `drivers` va acá porque adentro se pregunta por cada uno si está
    // conectado. Sin esta dependencia, el efecto se arma con la lista vacía y
    // se queda con esa para siempre: nadie aparecería nunca como conectado.
  }, [ready, drivers]);

  const CERRADOS: ShipmentStatus[] = useMemo(() => ['entregado', 'cancelado'], []);

  const visibles = useMemo(
    () => (soloPendientes ? envios.filter((s) => !CERRADOS.includes(s.status)) : envios),
    [envios, soloPendientes, CERRADOS],
  );

  /**
   * Azul oscuro: acá hay que ir a RETIRAR, no a entregar.
   *
   * Un envío tiene dos lugares y el mapa dibujaba siempre el segundo, también
   * para los paquetes que todavía están en el comercio. Desde la oficina eso se
   * lee como "ese envío está en camino a esa casa" cuando en realidad ni salió.
   */
  const AZUL_RETIRO = '#1e3a8a';

  type Ubicado = {
    envio: Shipment;
    lat: number | null;
    lng: number | null;
    enElComercio: boolean;
    comercio: string | null;
  };

  const ubicados: Ubicado[] = useMemo(
    () =>
      visibles.map((s) => {
        const sinRetirar = s.status === 'creado' || s.status === 'pendiente_retiro';
        const c = (s as Shipment & {
          comercio?: { name: string; lat: number | null; lng: number | null } | null;
        }).comercio;

        if (sinRetirar && c?.lat != null && c.lng != null) {
          return { envio: s, lat: Number(c.lat), lng: Number(c.lng), enElComercio: true, comercio: c.name };
        }

        return {
          envio: s,
          lat: s.lat != null ? Number(s.lat) : null,
          lng: s.lng != null ? Number(s.lng) : null,
          enElComercio: false,
          comercio: c?.name ?? null,
        };
      }),
    [visibles],
  );

  const conPunto = useMemo(() => ubicados.filter((u) => u.lat != null), [ubicados]);

  const sinPunto = visibles.length - conPunto.length;

  /**
   * Los repartidores que van al mapa.
   *
   * Sólo cuando el período incluye hoy: mirando el reparto de la semana pasada,
   * una moto en su posición de ahora no significa nada. Y si hay un repartidor
   * elegido en el filtro, se muestra sólo él.
   */
  const motos = useMemo(() => {
    const hoyEnRango = desde <= today() && today() <= hasta;
    if (!hoyEnRango) return [];
    return driverId ? enCalle.filter((r) => r.id === driverId) : enCalle;
  }, [enCalle, driverId, desde, hasta]);

  /**
   * Lo que se lee al lado del nombre. Una frase por estado, sin adornos: el que
   * mira el mapa está coordinando, no leyendo.
   */
  const comoEsta = (r: Repartidor): { texto: string; color: string } => {
    if (r.estado === 'desconectado') {
      return {
        texto: `desconectado · estuvo hasta las ${r.hora}`,
        color: 'var(--edr-muted)',
      };
    }
    if (r.estado === 'sin-senal') {
      return {
        texto: `sin señal desde las ${r.hora} · hace ${r.haceMinutos} min`,
        color: 'var(--edr-naranja-claro)',
      };
    }
    if (r.estado === 'parado') {
      // En horas cuando ya no se lee en minutos: "parado hace 137 min" obliga
      // a hacer la cuenta justo cuando el número empieza a importar.
      const m = r.quietoDesdeMin;
      const cuanto = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;

      return {
        texto: `parado hace ${r.quietoDesdeHaceMas ? 'más de ' : ''}${cuanto}`,
        color: 'var(--edr-muted)',
      };
    }
    return {
      texto: r.origen === 'entrega' ? `en una entrega · ${r.hora}` : `en movimiento · ${r.hora}`,
      color: 'var(--edr-verde-claro)',
    };
  };

  /* Cuáles de estos envíos son entregas del mismo viaje (paso 53). */
  useEffect(() => {
    let vivo = true;
    const traer = async () => {
      const p = await conHermanos(envios);
      if (vivo) setPuestos(p);
    };
    void traer();
    return () => {
      vivo = false;
    };
  }, [envios]);

  const puntosYGrupos = useMemo(() => {
    /*
     * UN SOLO PUNTO POR COMERCIO, con cuántos paquetes hay.
     *
     * Se dibujaba una marca por envío, y cuatro paquetes del mismo local son
     * cuatro marcas en la MISMA coordenada: se ve una sola, tapa a las otras
     * tres, y al tocarla se abre la de arriba como si fuera la única. Desde la
     * oficina eso significaba no poder ver qué tiene cada comercio esperando,
     * que es justo lo que se mira antes de mandar a alguien a retirar.
     */
    const porComercio = new Map<string, Ubicado[]>();
    const envios: PuntoMapa[] = [];

    for (const u of conPunto) {
      const s = u.envio;

      // En azul oscuro, con una R de retiro, los que todavía están en
      // el comercio. Es "acá hay que ir a buscar", no "acá hay que entregar".
      if (u.enElComercio) {
        const clave = `${u.lat},${u.lng}`;
        porComercio.set(clave, [...(porComercio.get(clave) ?? []), u]);
        continue;
      }

      const marca = marcaDeEstado(s.status);
      envios.push({
        id: s.id,
        lat: u.lat as number,
        lng: u.lng as number,
        etiqueta: marca.simbolo,
        color: marca.color,
        colorTexto: marca.colorTexto,
        titulo: s.address_street,
        detalle:
          `${nombreDelDestinatario(s)} · ${STATUS_LABEL[s.status]}` +
          (s.client_name_raw ? ` · ${s.client_name_raw}` : '') +
          // Dos pins del mismo envío se ven como dos envíos. Decirlo acá es lo
          // que hace que el mapa cuente la verdad: un viaje, dos paradas.
          (puestos.has(s.id) ? ` · 🔗 ${comoSeLlama(puestos.get(s.id)!)}` : ''),
      });
    }

    const grupos = new Map<number, Ubicado[]>();

    for (const delLugar of porComercio.values()) {
      const u = delLugar[0];
      grupos.set(u.envio.id, delLugar);
      envios.push({
        id: u.envio.id,
        lat: u.lat as number,
        lng: u.lng as number,
        etiqueta: 'R',
        color: AZUL_RETIRO,
        colorTexto: '#fff',
        titulo: `Retirar en ${u.envio.pickup_address ?? u.comercio ?? ''}`,
        detalle: `${u.comercio ?? 'Comercio'} · ${delLugar.length} para retirar`,
      });
    }

    // Las motos van con id negativo para no chocar con el de ningún envío:
    // tocar una no tiene que abrir la ficha de un envío cualquiera.
    const repartidores: PuntoMapa[] = motos.map((r, i) => ({
      id: -(i + 1),
      lat: r.lat,
      lng: r.lng,
      etiqueta: r.nombre.trim().charAt(0).toUpperCase() || '·',
      color: '#7c3aed',
      titulo: r.nombre,
      detalle: comoEsta(r).texto,
    }));

    return { puntos: [...envios, ...repartidores], grupos };
  }, [conPunto, motos, puestos]);

  const puntos = puntosYGrupos.puntos;
  const gruposDeRetiro = puntosYGrupos.grupos;

  /**
   * La referencia va por grupo y no por estado: son los tres colores que
   * aparecen en el mapa, ni uno más. Una referencia con siete estados de los
   * que se dibujan tres es ruido.
   */
  const porGrupo = useMemo(() => {
    const cuenta = new Map<string, { color: string; simbolo: string; n: number }>();
    for (const u of conPunto) {
      const m = marcaDeEstado(u.envio.status);
      const previo = cuenta.get(m.grupo);
      cuenta.set(m.grupo, {
        color: m.color,
        simbolo: m.simbolo,
        n: (previo?.n ?? 0) + 1,
      });
    }
    return [...cuenta.entries()].sort((a, b) => b[1].n - a[1].n);
  }, [conPunto]);

  if (!ready) return null;

  const hoy = today();

  return (
    <div className="min-h-full bg-[var(--edr-paper)]">

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <h2 className="mb-3 text-xl font-black sm:text-2xl">Mapa de envíos</h2>

        <section className="mb-3 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelCls}>Repartidor</label>
              <select
                className={campo}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                <option value="">Todos</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Desde</label>
              <input
                type="date"
                className={campo}
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Hasta</label>
              <input
                type="date"
                className={campo}
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <Atajo
                label="Hoy"
                onClick={() => {
                  setDesde(hoy);
                  setHasta(hoy);
                }}
              />
              <Atajo
                label="Ayer"
                onClick={() => {
                  setDesde(dayShift(hoy, -1));
                  setHasta(dayShift(hoy, -1));
                }}
              />
              <Atajo
                label="Últimos 7 días"
                onClick={() => {
                  setDesde(dayShift(hoy, -6));
                  setHasta(hoy);
                }}
              />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={soloPendientes}
                onChange={(e) => setSoloPendientes(e.target.checked)}
              />
              Sólo lo que falta hacer
            </label>
          </div>

          {/* La leyenda sale de lo que hay en pantalla y no de la lista fija de
              estados: una referencia con cinco colores que no están en el mapa
              es ruido. */}
          {/* Una pantalla que no explica su propio vacío se lee como rota: sin
              este cartel, mirar el mapa y no ver ninguna moto no dice si nadie
              está en la calle o si algo dejó de andar. */}
          {motos.length === 0 && desde <= today() && today() <= hasta && (
            <p className="mt-3 border-t border-[var(--edr-border)] pt-3 text-xs text-[var(--edr-muted)]">
              Todavía no hay ninguna posición de hoy. Aparecen acá mientras tengan envíos del
              día sin cerrar y hayan abierto la app: el celular la manda con la app en pantalla,
              así que la señal llega cuando la usan.
            </p>
          )}

          {motos.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--edr-border)] pt-3">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)]">
                En la calle ahora
              </span>
              {motos.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black text-white ring-1 ring-white/40"
                    style={{ background: '#7c3aed' }}
                  >
                    {r.nombre.trim().charAt(0).toUpperCase()}
                  </span>
                  <strong>{r.nombre}</strong>
                  <span
                    className={r.estado === 'moviendose' ? 'font-bold' : ''}
                    style={{ color: comoEsta(r).color }}
                  >
                    {comoEsta(r).texto}
                  </span>
                </span>
              ))}
            </div>
          )}

          {porGrupo.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {porGrupo.map(([grupo, g]) => (
                <span key={grupo} className="flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-black ring-1 ring-white/40"
                    style={{ background: g.color, color: grupo === 'Pendiente de entrega' ? '#111827' : '#fff' }}
                  >
                    {g.simbolo}
                  </span>
                  {grupo}: <strong>{g.n}</strong>
                </span>
              ))}
            </div>
          )}
        </section>

        {error && (
          <div className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        <p className="mb-2 text-sm text-[var(--edr-muted)]">
          {cargando
            ? 'Cargando…'
            : `${conPunto.length} en el mapa${
                sinPunto > 0 ? ` · ${sinPunto} sin ubicar (no se pueden marcar)` : ''
              }`}
        </p>

        {!cargando && conPunto.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-[var(--edr-border)] px-6 text-center text-sm text-[var(--edr-muted)]">
            {visibles.length === 0
              ? 'No hay envíos en ese período.'
              : 'Ninguno de los envíos de ese período tiene punto en el mapa. Se les puede poner a mano al editarlos.'}
          </div>
        ) : (
          <MapaEnvios
            puntos={puntos}
            // Los id negativos son repartidores: no tienen ficha de envío.
            onTocar={(id) => {
              if (id < 0) {
                setElegido(null);
                setEnElComercio(null);
                return;
              }

              const grupo = gruposDeRetiro.get(id);

              /*
               * Con uno solo se abre la ficha derecho.
               *
               * Una lista de un elemento es un toque de más para llegar a lo
               * mismo, y el caso de un solo paquete esperando es el más común
               * de todos.
               */
              if (grupo && grupo.length > 1) {
                setElegido(null);
                setEnElComercio(grupo);
                return;
              }

              setEnElComercio(null);
              setElegido(envios.find((s) => s.id === id) ?? null);
            }}
          />
        )}

        {/*
          Lo que espera en un comercio, cuando hay más de uno.

          Es la pregunta que se hace desde la oficina antes de mandar a alguien:
          "¿qué hay que retirar acá?". Cada fila abre su ficha.
        */}
        {enElComercio && enElComercio.length > 0 && (
          <div className="mt-3 rounded-lg border border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wide text-[var(--edr-acento)]">
                  Para retirar en
                </div>
                <div className="text-lg font-bold">
                  {enElComercio[0].envio.pickup_address ?? enElComercio[0].comercio}
                </div>
                <div className="text-sm text-[var(--edr-muted)]">
                  {enElComercio[0].comercio} · {enElComercio.length} envío(s)
                </div>
              </div>
              <button
                onClick={() => setEnElComercio(null)}
                aria-label="Cerrar"
                className="shrink-0 px-2 text-2xl leading-none text-[var(--edr-muted)]"
              >
                ×
              </button>
            </div>

            <ul className="mt-2 flex flex-col gap-1">
              {enElComercio.map((u) => (
                <li key={u.envio.id}>
                  <button
                    onClick={() => setElegido(u.envio)}
                    className="w-full rounded border border-[var(--edr-border)] px-2.5 py-2 text-left text-sm hover:border-[var(--edr-acento)]"
                  >
                    <span className="edr-mono text-xs text-[var(--edr-muted)]">
                      {u.envio.tracking_code}
                    </span>
                    <span className="block font-semibold">{u.envio.address_street}</span>
                    <span className="text-xs text-[var(--edr-muted)]">
                      {nombreDelDestinatario(u.envio)} · {STATUS_LABEL[u.envio.status]}
                      {u.envio.driver?.full_name ? ` · ${u.envio.driver.full_name}` : ' · sin asignar'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {elegido && <Ficha envio={elegido} onCerrar={() => setElegido(null)} />}
      </main>
    </div>
  );
}

function Atajo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-[var(--edr-border)] px-2 py-2 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
    >
      {label}
    </button>
  );
}

/** El detalle del envío que se tocó, abajo del mapa. */
function Ficha({ envio, onCerrar }: { envio: Shipment; onCerrar: () => void }) {
  const cash = shipmentCash(envio);
  return (
    <div className="mt-3 rounded-lg border border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="edr-mono text-xs text-[var(--edr-muted)]">{envio.tracking_code}</div>
          <div className="text-lg font-bold">{envio.address_street}</div>
          <div className="text-sm">
            {envio.recipient_name}
            {envio.client_name_raw ? ` · ${envio.client_name_raw}` : ''}
          </div>
          <div className="mt-1 text-sm text-[var(--edr-muted)]">
            {STATUS_LABEL[envio.status]}
            {cash.total > 0 && ` · a cobrar ${money(cash.total)}`}
          </div>
        </div>
        <button
          onClick={onCerrar}
          className="shrink-0 rounded px-2 text-2xl leading-none text-[var(--edr-muted)]"
          aria-label="Cerrar"
        >
          ×
        </button>
      </div>
    </div>
  );
}
