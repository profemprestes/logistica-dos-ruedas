import { diaAR, horaAR, horaDelDiaAR, hoyAR, type Shipment } from '@/lib/format';
import { faltaTexto, horarioDeRetiro, limiteDeLaFranja, textoFranja } from '@/lib/franja';

// Se reexporta porque las pruebas y el panel ya la importaban desde acá.
export { limiteDeLaFranja };

/**
 * Qué se está atrasando, ahora.
 *
 * La oficina no mira la tabla envío por envío: mira si hay algo que se está
 * yendo de las manos. Eso hasta hoy vivía en la cabeza del que atiende —"che,
 * el de Güemes no salió todavía"— y por eso se escapaba justo los días de
 * mucho trabajo, que son los días en que importa.
 *
 * Las cuatro reglas están escritas acá, en un solo lugar y con nombre, para
 * que se puedan discutir y cambiar sin tocar la pantalla. Son a propósito
 * groseras: prefieren avisar de más. Un aviso que no era nada cuesta una
 * mirada; un envío que se olvidó cuesta un cliente.
 *
 * Está separado de la pantalla porque es la parte que se puede equivocar sin
 * que se note: un aviso que no salta no deja rastro. Separado, se prueba.
 */

export type TipoAtraso = 'sin_asignar' | 'sin_retirar' | 'demorado' | 'sin_reprogramar';

export interface Atraso {
  /** Para la lista de React. Único aunque dos avisos sean del mismo tipo. */
  clave: string;
  tipo: TipoAtraso;
  /** El renglón chico de arriba: "SIN ASIGNAR". */
  titulo: string;
  /** De qué envío hablamos. */
  detalle: string;
  /** Desde cuándo viene pasando. Es lo que decide si urge. */
  desde: string;
  /** Rojo lo que no se movió; naranja lo que se está moviendo despacio. */
  tono: 'rojo' | 'naranja';
  accion: string;
  href: string;
}

/**
 * A qué hora deja de ser razonable que un envío siga sin retirar, cuando no
 * hay franja horaria acordada.
 *
 * A las tres de la tarde ya pasó la mañana entera: si a esa hora el comercio
 * todavía no entregó el paquete, o el repartidor no pasó, el envío de hoy
 * corre riesgo de no ser de hoy.
 */
export const CORTE_RETIRO_HS = 15;

/**
 * Cuánto antes del cierre de la franja hay que avisar.
 *
 * Retirar no es entregar: falta ir al comercio, cargarlo y recién después
 * llegar al domicilio, con las paradas que el repartidor tenga en el medio.
 * Dos horas es lo que da para que la entrega todavía entre en la franja.
 */
export const MARGEN_ANTES_DEL_CIERRE_HS = 2;

/**
 * A partir de acá deja de ser "apurate" y pasa a ser alerta.
 *
 * Con dos horas todavía hay margen para acomodar el reparto; con menos de una,
 * ya no: o sale ahora o no llega. Por eso cambia de color y de título, y no
 * espera a que la franja se pase para ponerse en rojo — avisar cuando ya se
 * incumplió es avisar tarde.
 */
export const ALERTA_ANTES_DEL_CIERRE_HS = 1;

/*
 * La comparación es ESTRICTA: con exactamente una hora todavía no es alerta.
 *
 * No es una sutileza. "Falta menos de una hora" tiene que querer decir eso, y
 * si a los sesenta minutos justos ya saltara en rojo, un envío con franja
 * hasta las 12 estaría en alerta desde las 11 — que es cuando el repartidor
 * recién está saliendo y todavía llega tranquilo. Un aviso que salta cuando no
 * hay nada que hacer es un aviso que se aprende a ignorar.
 */

/**
 * Cuánto puede durar un "en camino".
 *
 * Una entrega en Mar del Plata son quince minutos de moto. Hora y media
 * significa que el repartidor se olvidó de cerrarlo, que no encontró la
 * dirección, o que le pasó algo. Las tres cosas se quieren saber.
 */
export const MINUTOS_EN_CAMINO = 90;

/** Los que todavía tienen algo pendiente de hacerse. */
function abierto(s: Shipment): boolean {
  return s.status !== 'entregado' && s.status !== 'cancelado';
}

/** "13/08", del texto de la fecha y sin pasar por el calendario. */
function fechaCorta(fechaISO: string): string {
  const [, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}`;
}

/**
 * Cuándo entró, dicho de forma que no engañe.
 *
 * Un envío cargado ayer decía "entró 13:54" a secas, y eso se lee como las
 * 13:54 de hoy. Si no es de hoy, va el día adelante.
 */
function cuandoEntro(iso: string, hoy: string): string {
  const dia = hoyAR(new Date(iso));
  return dia === hoy ? horaAR(iso) : `${diaAR(iso)} a las ${horaAR(iso)}`;
}

/** "1 h 20 min", "35 min". Los minutos sueltos importan más que la precisión. */
function hace(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

function unEnvio(s: Shipment): string {
  const donde = [s.address_street, s.city].filter(Boolean).join(', ');
  return `${s.tracking_code} · ${donde}`;
}

export interface EntradaAtrasos {
  /** Los de hoy, más los no entregados que sigan sin reprogramar. */
  envios: Shipment[];
  /**
   * Desde cuándo cada envío está "en camino", en milisegundos.
   *
   * No sale de la tabla de envíos: ahí sólo está el estado actual, sin la hora
   * en que se llegó a él. Sale del historial de movimientos, que es el único
   * lugar donde queda registrado cuándo pasó cada cosa.
   */
  enCaminoDesde: Map<number, number>;
  ahora?: Date;
  hoy?: string;
}

export function buscarAtrasos({
  envios,
  enCaminoDesde,
  ahora = new Date(),
  hoy = hoyAR(ahora),
}: EntradaAtrasos): Atraso[] {
  const avisos: Atraso[] = [];
  const deHoy = envios.filter((s) => s.scheduled_date === hoy && abierto(s));
  const t = ahora.getTime();

  // ---- 1. Nadie lo va a llevar --------------------------------------------
  // Van juntos en un solo renglón a propósito: seis envíos sin repartidor son
  // un problema solo —hay que repartirlos— y no seis problemas.
  const sinAsignar = deHoy.filter((s) => !s.assigned_driver);
  if (sinAsignar.length) {
    const masViejo = sinAsignar.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
    avisos.push({
      clave: 'sin-asignar',
      tipo: 'sin_asignar',
      titulo: 'SIN ASIGNAR',
      detalle: `${sinAsignar.length} ${sinAsignar.length === 1 ? 'envío' : 'envíos'} de hoy sin repartidor`,
      desde: `el más viejo entró ${cuandoEntro(masViejo.created_at, hoy)}`,
      tono: 'rojo',
      accion: 'ASIGNAR',
      href: '/admin?repartidor=sin_asignar',
    });
  }

  /*
   * ---- 2. Tiene dueño pero sigue en el comercio ---------------------------
   *
   * LO QUE SE MIRA ES CUÁNTO FALTA PARA EL CIERRE, no hace cuánto se cargó.
   *
   * La primera versión contaba las horas desde `created_at`, y eso está mal
   * para los envíos que se cargan un día antes: uno cargado ayer a las 13:54
   * para hoy amanecía con diecinueve horas encima y saltaba a la madrugada,
   * cuando en realidad no había pasado nada. Y no es un caso raro: de cada
   * diez envíos, más de uno se carga para otro día.
   *
   * El compromiso no es "retirarlo rápido", es "entregarlo dentro de la
   * franja". Así que la cuenta va contra la franja: se avisa cuando ya no
   * queda margen para retirar y llegar a tiempo. Sin franja escrita, manda el
   * corte general de las 15.
   */
  const horaAhora = horaDelDiaAR(ahora);

  for (const s of deHoy) {
    if (!s.assigned_driver) continue;
    if (s.status !== 'creado' && s.status !== 'pendiente_retiro') continue;

    const cierre = limiteDeLaFranja(s.delivery_window);
    const avisarDesde =
      cierre !== null ? cierre - MARGEN_ANTES_DEL_CIERRE_HS : CORTE_RETIRO_HS;

    if (horaAhora < avisarDesde) continue;

    /*
     * Que falte margen y que la franja YA HAYA PASADO no son lo mismo.
     *
     * Lo primero es apurarse; lo segundo es que el compromiso con el
     * destinatario ya se incumplió y alguien tiene que avisarle. Por eso
     * cambia de color: deja de ser algo que se está moviendo despacio.
     */
    const vencida = cierre !== null && horaAhora > cierre;

    /*
     * Menos de una hora ya no es "se está moviendo despacio": o sale ahora o
     * no llega. Cambia de color antes de que la franja se pase, porque avisar
     * cuando ya se incumplió es avisar tarde.
     */
    const alFilo =
      !vencida && cierre !== null && cierre - horaAhora < ALERTA_ANTES_DEL_CIERRE_HS;

    const falta = cierre !== null ? Math.round((cierre - horaAhora) * 60) : null;
    const quien = s.driver?.full_name ?? 'Asignado';

    avisos.push({
      clave: `sin-retirar-${s.id}`,
      tipo: 'sin_retirar',
      titulo: vencida
        ? 'SIN RETIRAR · SE PASÓ LA FRANJA'
        : alFilo
          ? `SIN RETIRAR · CIERRA ${faltaTexto(falta!).toUpperCase()}`
          : 'SIN RETIRAR',
      detalle: unEnvio(s),
      desde: vencida
        ? `${quien} · había que entregarlo ${textoFranja(s.delivery_window)} y todavía está en el comercio`
        : cierre !== null
          ? `${quien} · hay que entregarlo ${textoFranja(s.delivery_window)}`
          : `${quien} · sin franja acordada · corte de retiro ${CORTE_RETIRO_HS} hs`,
      tono: vencida || alFilo ? 'rojo' : 'naranja',
      accion: 'VER',
      href: `/admin?buscar=${encodeURIComponent(s.tracking_code)}`,
    });
  }

  /*
   * ---- 2b. Ya lo tiene encima, pero la franja cierra ya --------------------
   *
   * La regla de arriba mira los que SIGUEN EN EL COMERCIO. Estos ya los tiene
   * el repartidor —retirados o en camino— y hasta ahora no avisaban nada hasta
   * que pasaba una hora y media en camino. Pero un envío retirado a las 11 con
   * franja hasta las 13 es urgente a las 12:20, no a las 14.
   *
   * Que esté en la moto no es que esté entregado. Lo único que cambia respecto
   * de la otra regla es qué hay que hacer: acá no es salir a buscarlo, es
   * llegar.
   */
  for (const s of deHoy) {
    if (s.status !== 'retirado' && s.status !== 'en_camino') continue;

    const cierre = limiteDeLaFranja(s.delivery_window);
    if (cierre === null) continue;

    const falta = Math.round((cierre - horaAhora) * 60);
    if (falta >= ALERTA_ANTES_DEL_CIERRE_HS * 60) continue;

    const quien = s.driver?.full_name ?? 'Repartidor';

    avisos.push({
      clave: `cierra-${s.id}`,
      tipo: 'demorado',
      titulo: falta < 0 ? 'SE PASÓ LA FRANJA' : `CIERRA ${faltaTexto(falta).toUpperCase()}`,
      detalle: unEnvio(s),
      desde: `${quien} · lo tiene encima · hay que entregarlo ${textoFranja(s.delivery_window)}`,
      tono: 'rojo',
      accion: 'VER MAPA',
      href: '/admin/mapa',
    });
  }

  /*
   * ---- 2c. El comercio está por cerrar ------------------------------------
   *
   * Otra restricción, y distinta de todas las de arriba: si el local cierra a
   * las 18 y a las 17:40 quedan tres paquetes ahí, hay un problema aunque la
   * entrega venza recién mañana. Después de que cierra ya no se puede hacer
   * nada hasta el otro día.
   *
   * El horario sale del comercio, o del envío cuando trae el suyo (paso 48).
   * Sin horario cargado no salta nada: no se adivina a qué hora cierra un
   * local, porque un aviso inventado es peor que ninguno.
   *
   * Van juntos por comercio: cinco paquetes en el mismo local que cierra son
   * un viaje, no cinco problemas.
   */
  const porCerrar = new Map<string, { envios: Shipment[]; texto: string; falta: number }>();

  for (const s of deHoy) {
    if (s.status !== 'creado' && s.status !== 'pendiente_retiro') continue;

    const retiro = horarioDeRetiro(s as Shipment & { comercio?: { pickup_window?: string | null } });
    if (!retiro) continue;

    const falta = Math.round((retiro.limite - horaAhora) * 60);
    if (falta >= ALERTA_ANTES_DEL_CIERRE_HS * 60) continue;

    const donde = (s.pickup_address ?? s.client_name_raw ?? 'el comercio').trim();
    const previo = porCerrar.get(donde);
    porCerrar.set(donde, {
      envios: [...(previo?.envios ?? []), s],
      texto: retiro.texto,
      // El más apurado manda: si dos envíos del mismo lugar tienen horarios
      // distintos, el que cierra antes es el que decide cuándo salir.
      falta: Math.min(previo?.falta ?? Infinity, falta),
    });
  }

  for (const [donde, x] of porCerrar) {
    const cuantos = x.envios.length;
    avisos.push({
      clave: `cierra-comercio-${donde}`,
      tipo: 'sin_retirar',
      titulo:
        x.falta < 0
          ? 'EL COMERCIO YA CERRÓ'
          : `EL COMERCIO CIERRA ${faltaTexto(x.falta).toUpperCase()}`,
      detalle: `${donde} · ${cuantos} ${cuantos === 1 ? 'paquete' : 'paquetes'} sin retirar`,
      desde:
        x.falta < 0
          ? `retiraba ${textoFranja(x.texto)} · quedan para mañana si nadie pasa`
          : `retira ${textoFranja(x.texto)}`,
      tono: 'rojo',
      accion: 'VER',
      href: `/admin?buscar=${encodeURIComponent(x.envios[0].tracking_code)}`,
    });
  }

  // ---- 3. Salió y no volvió ------------------------------------------------
  const limiteCamino = t - MINUTOS_EN_CAMINO * 60_000;

  for (const s of deHoy) {
    if (s.status !== 'en_camino') continue;
    const desdeCuando = enCaminoDesde.get(s.id);
    // Sin hora de salida no se inventa: un aviso que no se puede fechar no se
    // puede evaluar, y el que lo lee no sabría si mirarlo o no.
    if (!desdeCuando || desdeCuando > limiteCamino) continue;

    avisos.push({
      clave: `demorado-${s.id}`,
      tipo: 'demorado',
      titulo: `EN CAMINO HACE ${hace(t - desdeCuando)}`,
      detalle: unEnvio(s),
      desde: `${s.driver?.full_name ?? 'Repartidor'} · salió ${horaAR(new Date(desdeCuando))}`,
      tono: 'naranja',
      accion: 'VER MAPA',
      href: '/admin/mapa',
    });
  }

  // ---- 4. Se cerró mal y ahí quedó ----------------------------------------
  // Este es el único que mira más allá de hoy, y es el que más falta hacía: un
  // no entregado sin reprogramar no aparece en ninguna hoja de ruta, así que
  // no lo cruza nadie hasta que llama el comercio.
  for (const s of envios) {
    if (s.status !== 'pendiente_entrega' || s.reprogramado_en) continue;

    avisos.push({
      clave: `sin-reprogramar-${s.id}`,
      tipo: 'sin_reprogramar',
      titulo: 'NO ENTREGADO SIN REPROGRAMAR',
      detalle: unEnvio(s),
      desde: `quedó del ${fechaCorta(s.scheduled_date)} · el comercio espera respuesta`,
      tono: 'rojo',
      accion: 'REPROGRAMAR',
      href: `/admin?buscar=${encodeURIComponent(s.tracking_code)}`,
    });
  }

  // Los rojos primero: son los que nadie está mirando. Los naranjas están en
  // manos de alguien, aunque tarde.
  const peso: Record<Atraso['tono'], number> = { rojo: 0, naranja: 1 };
  return avisos.sort((a, b) => peso[a.tono] - peso[b.tono]);
}
