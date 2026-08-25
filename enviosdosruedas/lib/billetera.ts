import { supabase } from '@/lib/supabaseClient';
import { hoyAR } from '@/lib/format';
import {
  conLosMovimientos,
  logCash,
  pagoDelEnvio,
  type DeliveryLog,
} from '@/lib/settlement';

/**
 * La cuenta corriente de cada repartidor.
 *
 * EL MODELO ES DE DOS NIVELES, y así trabaja la empresa (24/08/2026):
 *
 *   · EL CIERRE DEL DÍA es el control diario: efectivo cobrado, efectivo
 *     rendido ESE día (a mano, arranca en 0), envíos, y el total del día — a
 *     rendir o a cobrar. Ese rendido diario vive en el cierre
 *     (`settlements.actual_amount`) y esta cuenta lo suma con la fecha del día.
 *
 *   · LA BILLETERA acumula esos totales diarios como pendiente, y al final de
 *     la semana se hace EL CIERRE SEMANAL: si tiene que cobrar se le paga, si
 *     tiene que rendir lo rinde. Esos son los `movimientos_caja` — rendición,
 *     pago, ajuste — con su propia fecha, y no figuran en el cierre de ningún
 *     día.
 *
 * ES UN SOLO NÚMERO, y es EL MISMO que da el cierre de caja. Así se rinde acá:
 * el repartidor se queda con su parte de lo que cobró y entrega la diferencia.
 * "Total a rendir $ 59.100" del cierre es cobró $ 78.400 menos sus $ 19.300 —
 * nunca entrega los $ 78.400 para después cobrar aparte. La primera versión
 * mostraba esas dos platas por separado, y el dueño la leyó como que el
 * repartidor debía $ 78.400: un número que ninguna rendición real iba a
 * empardar. La cuenta que no coincide con la plata sobre la mesa no sirve.
 *
 *   saldo = cobrado − su parte − rendido (diario + semanal) + pagado + ajustes
 *
 * Positivo: tiene que rendir. Negativo: hay que pagarle.
 */

/**
 * Desde cuándo cuenta la billetera.
 *
 * Antes de este lunes el sistema se estaba probando: los movimientos que
 * quedaron son de ensayo y meterlos en la cuenta corriente sería arrancar con
 * un saldo inventado.
 *
 * LA MISMA FECHA ESTÁ EN `sql/paso55`. Si acá se cuenta desde un día y allá se
 * mudaron los cierres desde otro, el saldo de la pantalla no va a coincidir con
 * el de la base y no habría forma de saber cuál de los dos miente.
 */
export const ARRANCA = '2026-08-17';

export type TipoMovimiento = 'rendicion' | 'pago' | 'ajuste';

export interface MovimientoCaja {
  id: number;
  driver_id: string;
  fecha: string;
  tipo: TipoMovimiento;
  monto: number;
  nota: string | null;
  cargado_por: string | null;
  created_at: string;
}

/** El rendido a mano de un cierre de día: cuánto entregó ese día. */
export interface RendidoDeCierre {
  /** El día del cierre, yyyy-mm-dd. */
  day: string;
  monto: number;
}

export interface Billetera {
  driverId: string;
  /** Efectivo que cobró en la calle desde que arranca la cuenta. */
  cobrado: number;
  /** Su parte por los envíos que hizo: lo que se queda de lo cobrado. */
  suParte: number;
  /** Lo que ya entregó en la oficina: los rendidos diarios más los cierres semanales. */
  rendido: number;
  /** Lo que se le pagó de nuestro bolsillo (cuando cobra menos de su parte). */
  pagado: number;
  /** Ajustes a mano, con su signo. */
  ajustes: number;
  /**
   * EL número: lo que tiene que rendir hoy, ya descontada su parte.
   * Positivo: nos debe la diferencia. Negativo: hay que pagarle.
   */
  saldo: number;
  movimientos: MovimientoCaja[];
  /** Los rendidos diarios de los cierres, para el día por día. */
  cierres: RendidoDeCierre[];
  /** Los movimientos de la calle, para poder mostrar el detalle. */
  logs: DeliveryLog[];
}

const CAMPOS = 'id, driver_id, fecha, tipo, monto, nota, cargado_por, created_at';

/** El día de hoy en Mar del Plata, que es lo que hay que escribir en `fecha`. */
export function hoyEnCasa(): string {
  const ahora = new Date();
  return new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Una cuenta en cero, para arrancar. */
export function billeteraVacia(id: string): Billetera {
  return {
    driverId: id,
    cobrado: 0,
    suParte: 0,
    rendido: 0,
    pagado: 0,
    ajustes: 0,
    saldo: 0,
    movimientos: [],
    cierres: [],
    logs: [],
  };
}

/**
 * La cuenta, hecha con lo que pasó en la calle y lo que se anotó.
 *
 * Está separada de la consulta y sin base de datos adentro para poder probarla
 * sola: son las reglas de cuánta plata debe cada uno, y meterlas atrás de un
 * `select` las vuelve imposibles de revisar.
 */
export function armarBilletera(
  id: string,
  logs: DeliveryLog[],
  movimientos: MovimientoCaja[],
  /** Los rendidos a mano de los cierres de día. */
  cierres: RendidoDeCierre[] = [],
): Billetera {
  const c = billeteraVacia(id);

  for (const l of logs) {
    c.logs.push(l);
    c.cobrado += logCash(l);

    // Su parte sale de los envíos ENTREGADOS, con las mismas reglas que los
    // resúmenes y el cierre de caja. Un retiro no le paga nada.
    if (l.event === 'entregado') c.suParte += pagoDelEnvio(l);
  }

  for (const m of movimientos) {
    c.movimientos.push(m);
    const monto = Number(m.monto);

    if (m.tipo === 'rendicion') c.rendido += monto;
    else if (m.tipo === 'pago') c.pagado += monto;
    else c.ajustes += monto;
  }

  // El rendido diario de cada cierre suma igual que una rendición: es plata
  // que ya está en la oficina, sólo que anotada desde el cierre del día.
  for (const x of cierres) {
    c.cierres.push(x);
    c.rendido += Number(x.monto);
  }

  c.saldo = Math.round(c.cobrado - c.suParte - c.rendido + c.pagado + c.ajustes);

  return c;
}

/** Un día de la cuenta, con lo que entró, lo que salió y cómo quedó. */
export interface DiaDeCaja {
  /** yyyy-mm-dd, en hora de Mar del Plata. */
  fecha: string;
  /** Efectivo que cobró en la calle ese día. */
  cobrado: number;
  /** Su parte por los envíos que entregó ese día. */
  suParte: number;
  /** Lo que quedó a rendir POR ese día: cobrado menos su parte. */
  delDia: number;
  /** Lo que entregó ese día. */
  rendido: number;
  /** Lo que se le pagó ese día. */
  pagado: number;
  ajustes: number;
  /**
   * Cómo quedó la cuenta ENTERA al terminar ese día, contando desde el
   * principio. Positivo: le quedaba por rendir. Negativo: se le debía.
   */
  saldo: number;
  /** Cuántas entregas hizo. Para poder decir "6 entregas" y no sólo plata. */
  entregas: number;
}

/**
 * La cuenta partida día por día, con el saldo arrastrándose.
 *
 * POR QUÉ ARRASTRA. Un día suelto no contesta nada: el repartidor quedó
 * debiendo $ 30.000 el lunes y $ 5.000 el martes. Mirando el martes solo
 * parece que debe $ 5.000; lo que la oficina le va a pedir es $ 35.000. Por
 * eso cada día muestra cómo quedó la cuenta ENTERA hasta ahí.
 *
 * Los días sin nada no aparecen: una lista con los domingos en cero es más
 * larga y dice menos.
 *
 * Va del más nuevo al más viejo. Lo que se mira es lo de recién.
 */
export function porDia(c: Billetera): DiaDeCaja[] {
  const dias = new Map<string, DiaDeCaja>();

  const enDia = (fecha: string): DiaDeCaja => {
    const d = dias.get(fecha) ?? {
      fecha,
      cobrado: 0,
      suParte: 0,
      delDia: 0,
      rendido: 0,
      pagado: 0,
      ajustes: 0,
      saldo: 0,
      entregas: 0,
    };
    dias.set(fecha, d);
    return d;
  };

  for (const l of c.logs) {
    // La hora de acá, no la del servidor: una entrega de las diez de la noche
    // se guarda con la fecha del día siguiente en UTC.
    const d = enDia(hoyAR(new Date(l.happened_at)));
    d.cobrado += logCash(l);
    if (l.event === 'entregado') {
      d.suParte += pagoDelEnvio(l);
      d.entregas += 1;
    }
  }

  for (const m of c.movimientos) {
    const d = enDia(m.fecha);
    const monto = Number(m.monto);
    if (m.tipo === 'rendicion') d.rendido += monto;
    else if (m.tipo === 'pago') d.pagado += monto;
    else d.ajustes += monto;
  }

  // El rendido diario del cierre cae en su día, junto a lo que cobró.
  for (const x of c.cierres) {
    enDia(x.day).rendido += Number(x.monto);
  }

  const enOrden = [...dias.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));

  let saldo = 0;
  for (const d of enOrden) {
    d.delDia = Math.round(d.cobrado - d.suParte);
    saldo += d.cobrado - d.suParte - d.rendido + d.pagado + d.ajustes;
    d.saldo = Math.round(saldo);
  }

  return enOrden.reverse();
}

/** Lo que pasó entre dos fechas, sumado del día por día. */
export interface ResumenDeRango {
  cobrado: number;
  suParte: number;
  /** Lo que quedó a rendir por esos días: la suma de "A rendir" de cada uno. */
  aRendir: number;
  rendido: number;
  pagado: number;
  ajustes: number;
  entregas: number;
  /** Cómo quedó la cuenta ENTERA al cierre del último día del rango. */
  saldoAlCierre: number;
  /** Cuántos días con movimiento caen adentro. */
  dias: number;
}

/**
 * El resumen de un rango de fechas (las dos puntas van incluidas).
 *
 * OJO CON LO QUE ES Y LO QUE NO ES. Las sumas son de lo que PASÓ esos días;
 * `saldoAlCierre` es la cuenta entera arrastrada desde el principio, no la del
 * rango. Un rango no tiene saldo propio: recortar la cuenta a una ventana
 * daría un número que no coincide con ninguna plata real — exactamente el
 * error que esta billetera vino a sacar.
 */
export function resumenDelRango(c: Billetera, desde: string, hasta: string): ResumenDeRango {
  const r: ResumenDeRango = {
    cobrado: 0,
    suParte: 0,
    aRendir: 0,
    rendido: 0,
    pagado: 0,
    ajustes: 0,
    entregas: 0,
    saldoAlCierre: 0,
    dias: 0,
  };

  // porDia viene del más nuevo al más viejo: el primero que entra al rango es
  // su cierre.
  for (const d of porDia(c)) {
    if (d.fecha < desde || d.fecha > hasta) continue;
    if (r.dias === 0) r.saldoAlCierre = d.saldo;
    r.dias += 1;
    r.cobrado += d.cobrado;
    r.suParte += d.suParte;
    r.aRendir += d.delDia;
    r.rendido += d.rendido;
    r.pagado += d.pagado;
    r.ajustes += d.ajustes;
    r.entregas += d.entregas;
  }

  return r;
}

/**
 * La billetera de uno o de todos, desde que arranca la cuenta hasta hoy.
 *
 * Va sin fechas de corte a propósito. Un saldo es lo que hay AHORA: recortarlo
 * a una ventana daría un número que no le sirve a nadie para decidir cuánta
 * plata pedir ni cuánta pagar.
 */
export async function traerBilleteras(driverIds: string[]): Promise<Map<string, Billetera>> {
  const cuentas = new Map(driverIds.map((id) => [id, billeteraVacia(id)]));
  if (!driverIds.length) return cuentas;

  const desde = `${ARRANCA}T00:00:00`;

  const [porLaCalle, anotados, deCierres] = await Promise.all([
    conLosMovimientos<(DeliveryLog & { driver_id: string })[]>((select) =>
      supabase
        .from('delivery_logs')
        .select(`${select}, driver_id`)
        .in('driver_id', driverIds)
        .gte('happened_at', new Date(desde).toISOString())
        .order('happened_at'),
    ),
    supabase
      .from('movimientos_caja')
      .select(CAMPOS)
      .in('driver_id', driverIds)
      .gte('fecha', ARRANCA)
      .order('fecha', { ascending: false }),
    /*
     * Los rendidos diarios, del cierre de cada día.
     *
     * DESDE ARRANCA IGUAL QUE TODO: antes del 17/08 hay cierres con montos de
     * prueba (el 12/08 dice "rindió $ 55.000") que meterían plata inventada.
     * Y sólo los mayores a cero: el cero es el valor de "no entregó nada",
     * que es casi todos los días.
     */
    supabase
      .from('settlements')
      .select('driver_id, day, actual_amount')
      .in('driver_id', driverIds)
      .gte('day', ARRANCA)
      .gt('actual_amount', 0),
  ]);

  const suyos = new Map(driverIds.map((id) => [id, [] as DeliveryLog[]]));
  for (const l of porLaCalle.data ?? []) suyos.get(l.driver_id)?.push(l);

  // Si la tabla todavía no existe —el paso 55 se corre a mano— la billetera
  // muestra lo de la calle y ninguna entrega. Es incompleto, no está roto.
  const anotadosDe = new Map(driverIds.map((id) => [id, [] as MovimientoCaja[]]));
  for (const m of (anotados.data ?? []) as MovimientoCaja[]) anotadosDe.get(m.driver_id)?.push(m);

  const cierresDe = new Map(driverIds.map((id) => [id, [] as RendidoDeCierre[]]));
  for (const c of deCierres.data ?? []) {
    cierresDe.get(c.driver_id)?.push({ day: c.day, monto: Number(c.actual_amount) });
  }

  for (const id of driverIds) {
    cuentas.set(
      id,
      armarBilletera(id, suyos.get(id) ?? [], anotadosDe.get(id) ?? [], cierresDe.get(id) ?? []),
    );
  }

  return cuentas;
}

/** Anota una entrega de plata, un pago o un ajuste. Sólo la oficina. */
export async function anotar(m: {
  driverId: string;
  fecha: string;
  tipo: TipoMovimiento;
  monto: number;
  nota?: string;
}): Promise<{ error?: string }> {
  if (!Number.isFinite(m.monto) || (m.tipo !== 'ajuste' && m.monto <= 0)) {
    return { error: 'Poné cuánta plata, en números y mayor que cero.' };
  }
  if (m.tipo === 'ajuste' && m.monto === 0) {
    return { error: 'Un ajuste de cero no mueve nada.' };
  }

  const { data: sesion } = await supabase.auth.getUser();

  const { error } = await supabase.from('movimientos_caja').insert({
    driver_id: m.driverId,
    fecha: m.fecha,
    tipo: m.tipo,
    monto: m.monto,
    nota: m.nota?.trim() || null,
    cargado_por: sesion.user?.id ?? null,
  });

  return error ? { error: traducir(error.message) } : {};
}

/** Borra un movimiento mal cargado. Sólo la oficina. */
export async function borrarMovimiento(id: number): Promise<{ error?: string }> {
  const { error } = await supabase.from('movimientos_caja').delete().eq('id', id);
  return error ? { error: traducir(error.message) } : {};
}

function traducir(mensaje: string): string {
  if (/movimientos_caja/.test(mensaje) && /does not exist|relation/.test(mensaje)) {
    return 'Falta correr el paso 55 en la base. Hasta entonces no se pueden anotar rendiciones.';
  }
  if (/row-level security/.test(mensaje)) {
    return 'Sólo la oficina puede anotar movimientos de caja.';
  }
  return mensaje;
}

export const NOMBRE_TIPO: Record<TipoMovimiento, string> = {
  rendicion: 'Rindió',
  pago: 'Le pagamos',
  ajuste: 'Ajuste',
};
