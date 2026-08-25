/**
 * Las cuentas del resumen del repartidor.
 *
 * Vienen del generador que se usaba aparte, en un HTML suelto, y están
 * portadas TAL CUAL: los números que salen de acá son los que se vienen
 * pagando. Si algo tenía que cambiar, se cambia después y a propósito, no de
 * arrastre en la mudanza.
 *
 * Lo único que sí cambió es que las reglas dejaron de estar escondidas adentro
 * de un `if`: están todas juntas en REGLAS, con nombre y a la vista.
 */

/**
 * Las reglas de plata, en un solo lugar.
 *
 * Antes estaban repartidas por el código —el 0.7 en un lado, el 0.3 en otro,
 * los nombres de los comercios dentro de una condición— y para cambiar una
 * tarifa había que buscarla. Acá se leen de un vistazo.
 */
export const REGLAS = {
  /** Lo que se queda la mensajería de cada envío normal. El resto va al repartidor. */
  comision: 0.3,

  /** Envío de Shippy cuando la línea no dice precio. */
  envioShippyPorDefecto: 3000,

  /**
   * Lo que deja cada envío de Shippy.
   *
   * OJO: es un número fijo por envío, no sale de lo que se carga. Shippy le
   * paga el envío entero al repartidor y la ganancia se acuerda aparte, así
   * que si esa negociación cambia, este número hay que cambiarlo a mano —
   * ninguna otra cosa del sistema se va a dar cuenta.
   */
  gananciaPorShippy: 2000,

  /** Los comercios que se liquidan como Shippy, sin comisión. */
  comerciosShippy: ['KILLARI', 'SHOPIGO', 'SHIPPY'],

  /**
   * Comercios con trato directo, aparte de Shippy: sin comisión, el valor del
   * envío va ENTERO al repartidor, y cuando el envío no trae valor se usa el
   * acordado. Definido por Matías el 25/08/2026.
   *
   * `gananciaPorEnvio` es lo que deja cada envío a la empresa, que se cobra
   * aparte (como con Shippy). En cero quiere decir que ese número todavía no
   * está definido: el sistema no lo inventa.
   */
  tratoDirecto: {
    /*
     * A Conectta se le FACTURA $3.000 por envío entregado (fijo, lo aclare o
     * no) y al repartidor se le pagan $2.000. `gananciaPorEnvio` sigue en 0
     * hasta que Matías confirme el número — probablemente sea la diferencia,
     * pero la plata no se supone.
     */
    CONECTTA: { envioPorDefecto: 2000, gananciaPorEnvio: 0, facturaPorEnvio: 3000 },
  } as Record<
    string,
    { envioPorDefecto: number; gananciaPorEnvio: number; facturaPorEnvio?: number }
  >,
} as const;

export function esShippy(comercio: string): boolean {
  const c = (comercio ?? '').toUpperCase();
  return REGLAS.comerciosShippy.some((s) => c.includes(s));
}

/** La regla de trato directo de ese comercio, si tiene. Mismo criterio que `esShippy`. */
export function tratoDirectoDe(
  comercio: string,
): { envioPorDefecto: number; gananciaPorEnvio: number; facturaPorEnvio?: number } | null {
  const c = (comercio ?? '').toUpperCase();
  const clave = Object.keys(REGLAS.tratoDirecto).find((k) => c.includes(k));
  return clave ? REGLAS.tratoDirecto[clave] : null;
}

/**
 * Si a este comercio no se le descuenta comisión: Shippy o trato directo.
 * El valor del envío es lo que se le paga al repartidor, entero.
 */
export function esSinComision(comercio: string): boolean {
  return esShippy(comercio) || tratoDirectoDe(comercio) !== null;
}

/**
 * El valor acordado del envío cuando no se aclara. `null` para los comercios
 * comunes: ahí no hay nada acordado que suponer.
 */
export function envioPorDefectoDe(comercio: string): number | null {
  if (esShippy(comercio)) return REGLAS.envioShippyPorDefecto;
  return tratoDirectoDe(comercio)?.envioPorDefecto ?? null;
}

export interface Pedido {
  /** Identificador para la tabla; no se guarda. */
  tempId: string;
  /** Cómo se llama el comercio en el resumen: los de Shippy se muestran juntos. */
  comercio: string;
  /** El nombre real, que es el que interesa para facturarle a cada uno. */
  comercioOriginal: string;
  descripcion: string;
  cobrar: number;
  envio: number;
  esShippy: boolean;
  /** Si vino del sistema, de qué envío salió. Los pegados a mano no tienen. */
  shipmentId?: number | null;
}

export interface Totales {
  efectivoNormal: number;
  efectivoShippy: number;
  efectivoTotal: number;
  enviosNormales: number;
  enviosShippy: number;
  /** Envíos de comercios con trato directo (Conectta): al 100%, como Shippy. */
  enviosDirecto: number;
  /** Lo que le toca al repartidor por los envíos normales (el 70%). */
  aPagarNormales: number;
  /** Todo lo que hay que pagarle: normales al 70% más Shippy al 100%. */
  aPagarTotal: number;
  /** Lo que deja la mensajería: comisión de los normales más lo de Shippy. */
  ganancia: number;
  /**
   * El número del final. Positivo, el repartidor rinde plata; negativo, hay
   * que pagarle a él.
   */
  aRendir: number;
  cantidadShippy: number;
}

export interface Ajustes {
  /** Lo que venía debiendo de días anteriores. */
  pendiente: number;
  /** Lo que ya entregó a cuenta. */
  rendido: number;
  /** Dejar el efectivo de Shippy afuera de la caja (lo rinde por otro lado). */
  excluirEfectivoShippy: boolean;
}

export function calcular(pedidos: Pedido[], ajustes: Ajustes): Totales {
  let efectivoNormal = 0;
  let efectivoShippy = 0;
  let enviosNormales = 0;
  let enviosShippy = 0;
  let enviosDirecto = 0;
  let gananciaDirecto = 0;
  let cantidadShippy = 0;

  for (const p of pedidos) {
    /*
     * Tres tarifas y no dos: normales al 70%, Shippy al 100% con su ganancia
     * fija, y el trato directo (Conectta) al 100% con la ganancia de SU regla.
     * El efectivo del trato directo va a la caja normal: sólo el de Shippy se
     * puede apartar (`excluirEfectivoShippy`).
     */
    const trato = p.esShippy ? null : tratoDirectoDe(p.comercioOriginal);

    if (p.esShippy) {
      efectivoShippy += p.cobrar;
      enviosShippy += p.envio;
      cantidadShippy++;
    } else if (trato) {
      efectivoNormal += p.cobrar;
      enviosDirecto += p.envio;
      gananciaDirecto += trato.gananciaPorEnvio;
    } else {
      efectivoNormal += p.cobrar;
      enviosNormales += p.envio;
    }
  }

  const aPagarNormales = enviosNormales * (1 - REGLAS.comision);
  const aPagarTotal = aPagarNormales + enviosShippy + enviosDirecto;
  const ganancia =
    enviosNormales * REGLAS.comision +
    cantidadShippy * REGLAS.gananciaPorShippy +
    gananciaDirecto;

  const efectivoAContemplar =
    efectivoNormal + (ajustes.excluirEfectivoShippy ? 0 : efectivoShippy);
  const aRendir = ajustes.pendiente + efectivoAContemplar - aPagarTotal - ajustes.rendido;

  return {
    efectivoNormal,
    efectivoShippy,
    efectivoTotal: efectivoNormal + efectivoShippy,
    enviosNormales,
    enviosShippy,
    enviosDirecto,
    aPagarNormales,
    aPagarTotal,
    ganancia,
    aRendir,
    cantidadShippy,
  };
}

/* --------------------------------------------------------------- los textos */

export const plata = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

/** "BOLIVAR 4167" -> "Bolivar 4167". Como salía del generador viejo. */
export function capitalizar(texto: string): string {
  const s = (texto ?? '').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * El resumen largo, el que se le manda al repartidor.
 *
 * Los envíos de Shippy que salen al precio de lista van en una sola línea
 * ("Shippy x12"): son todos iguales y ocuparían media pantalla. Los que tienen
 * otro precio van sueltos, porque ahí el número importa.
 */
export function textoDetallado(
  repartidor: string,
  pedidos: Pedido[],
  ajustes: Ajustes,
  t: Totales,
): string {
  const lineas: string[] = [];
  let n = 1;

  let shippyIguales = 0;
  let shippyIgualesCobrar = 0;
  let shippyIgualesEnvio = 0;

  for (const p of pedidos) {
    const desc = capitalizar(p.descripcion);

    if (p.esShippy) {
      if (p.envio === REGLAS.envioShippyPorDefecto) {
        shippyIguales++;
        shippyIgualesCobrar += p.cobrar;
        shippyIgualesEnvio += p.envio;
      } else {
        lineas.push(
          `${n}) ${desc}. Cobrar ${plata(p.cobrar)} Envío ${plata(p.envio)} (sin comisión)`,
        );
        n++;
      }
      continue;
    }

    let linea = `${n}) ${desc}. `;
    if (p.cobrar === p.envio && p.cobrar > 0) {
      linea += `Cobrar envío ${plata(p.cobrar)}`;
    } else {
      if (p.cobrar > 0) linea += `Cobrar ${plata(p.cobrar)} `;
      if (p.envio > 0) linea += `Envío ${plata(p.envio)}`;
    }
    lineas.push(linea.trimEnd());
    n++;
  }

  if (shippyIguales > 0) {
    lineas.push(
      `${n}) Shippy x${shippyIguales}. Cobrar ${plata(shippyIgualesCobrar)}. ` +
        `Envío ${plata(shippyIgualesEnvio)} (sin comisión)`,
    );
  }

  let txt = `*${repartidor}*\n\n${lineas.join('\n')}\n\n`;

  if (ajustes.excluirEfectivoShippy) {
    txt += `Efectivo cobrado Normal: ${plata(t.efectivoNormal)}\n`;
    txt += `Efectivo cobrado Shippy: ${plata(t.efectivoShippy)} (EXCLUIDO)\n`;
    txt += `Total efectivo a contemplar en caja: ${plata(t.efectivoNormal)}\n\n`;
  } else {
    txt += `Efectivo cobrado total en calle: ${plata(t.efectivoTotal)}\n\n`;
  }

  txt += `Total envíos de locales (sin comisión): ${plata(t.enviosNormales)}\n`;
  txt += `Total envíos Shippy (netos): ${plata(t.enviosShippy)}\n\n`;
  txt +=
    `Envíos a pagar al cadete: ${plata(t.aPagarNormales)} (Normales) + ` +
    `${plata(t.enviosShippy)} (Shippy)${t.enviosDirecto > 0 ? ` + ${plata(t.enviosDirecto)} (Directo)` : ''} = ${plata(t.aPagarTotal)}\n\n`;

  if (ajustes.rendido > 0) txt += `Rendido hoy a cuenta: ${plata(ajustes.rendido)}\n`;
  if (ajustes.pendiente > 0) txt += `Efectivo pendiente a rendir: ${plata(ajustes.pendiente)}\n`;

  txt +=
    t.aRendir < 0
      ? `\n*TOTAL A COBRAR (Abonar a repartidor): ${plata(Math.abs(t.aRendir))}*\n`
      : `\nTotal a rendir: ${plata(t.aRendir)}\n`;

  return txt;
}

/** El mismo resumen agrupado por comercio, para cuando el día fue largo. */
export function textoCompacto(repartidor: string, pedidos: Pedido[], t: Totales): string {
  const grupos = new Map<string, { cantidad: number; cobrar: number; envio: number }>();

  for (const p of pedidos) {
    const clave = capitalizar(p.comercio);
    const g = grupos.get(clave) ?? { cantidad: 0, cobrar: 0, envio: 0 };
    g.cantidad++;
    g.cobrar += p.cobrar;
    g.envio += p.envio;
    grupos.set(clave, g);
  }

  let txt = `*${repartidor} - COMPACTO*\n\n`;

  for (const [comercio, g] of grupos) {
    let linea = `- ${comercio} x${g.cantidad}. `;
    if (g.cobrar === g.envio && g.cobrar > 0) linea += `Cobrar envío ${plata(g.cobrar)}`;
    else {
      if (g.cobrar > 0) linea += `Cobrar ${plata(g.cobrar)} `;
      if (g.envio > 0) linea += `Envío ${plata(g.envio)}`;
    }
    txt += `${linea.trim()}\n`;
  }

  txt += `\nEnvíos a pagar al cadete: ${plata(t.aPagarTotal)}`;
  txt +=
    t.aRendir < 0
      ? `\n*TOTAL A COBRAR (Abonar a repartidor): ${plata(Math.abs(t.aRendir))}*`
      : `\nTotal a rendir: ${plata(t.aRendir)}`;

  return txt.trim();
}
