import { buscarEnvio, type TrackLookup } from '@/lib/trackServer';

/**
 * Freno para el seguimiento público.
 *
 * EL PROBLEMA. Los códigos son correlativos —EDR00001060, EDR00001061— y el
 * seguimiento contesta con la dirección y el estado. Probado el 13/08/2026:
 * de diez códigos seguidos, siete devolvieron dirección; quince consultas de
 * golpe, ninguna frenada. Con un script de veinte líneas cualquiera se lleva
 * las direcciones de todos los clientes.
 *
 * QUÉ SE CUENTA, Y POR QUÉ ASÍ. No la cantidad de consultas, sino cuántos
 * CÓDIGOS DISTINTOS pidió cada uno. Es la diferencia entre las dos conductas:
 *
 *   - Un cliente mira uno o dos envíos y refresca para ver si la moto se
 *     acerca. Pocos códigos, muchas veces. No lo frena nunca, ni aunque
 *     refresque cada diez segundos toda la tarde.
 *   - Un comercio con veinte envíos mira sus veinte. Entra cómodo.
 *   - El que va contando códigos pide cientos distintos, una vez cada uno. Ese
 *     choca contra el tope enseguida.
 *
 * Contar consultas a secas obligaría a elegir entre molestar al que refresca o
 * dejar pasar al que cuenta. Contando códigos distintos no hay que elegir.
 *
 * HASTA DÓNDE LLEGA. La cuenta vive en la memoria del servidor: si el hosting
 * levanta otra instancia, esa arranca con la cuenta en cero, y un reinicio la
 * borra. O sea que no es una pared, es un costo: el que quiera barrer la base
 * va a tener que trabajar bastante más. Para una pared de verdad hay que
 * guardarlo en la base, y eso ya es otra conversación.
 */

/** Ventana de tiempo que se mira hacia atrás. */
const VENTANA_MS = 60 * 60 * 1000;

/**
 * Códigos distintos por hora y por dirección de internet.
 *
 * Cincuenta es holgado a propósito: el uso normal más pesado que existe es un
 * comercio revisando toda su tanda del día, y eso son veinte. Preferimos que
 * no moleste nunca a nadie y que igual haga lento el barrido.
 */
const CODIGOS_POR_VENTANA = 50;

/** Tope de direcciones en memoria, para que esto no crezca sin fin. */
const MAX_IPS = 5_000;

/** Por cada dirección: qué códigos pidió y cuándo fue la última vez. */
const vistos = new Map<string, Map<string, number>>();

/**
 * De dónde viene la consulta.
 *
 * `x-real-ip` primero porque lo escribe el hosting y el que consulta no lo
 * puede tocar. `x-forwarded-for` se puede inventar desde afuera, así que sirve
 * de respaldo y nada más.
 */
export function ipDeLaConsulta(headers: Headers): string {
  const real = headers.get('x-real-ip');
  if (real) return real.trim();

  const reenviado = headers.get('x-forwarded-for');
  if (reenviado) return reenviado.split(',')[0].trim();

  return 'sin-direccion';
}

/** Saca lo que ya no cuenta y, si hay demasiadas direcciones, las más viejas. */
function limpiar(ahora: number) {
  for (const [ip, codigos] of vistos) {
    for (const [codigo, cuando] of codigos) {
      if (ahora - cuando > VENTANA_MS) codigos.delete(codigo);
    }
    if (codigos.size === 0) vistos.delete(ip);
  }

  if (vistos.size > MAX_IPS) {
    const porAntiguedad = [...vistos.entries()]
      .map(([ip, codigos]) => [ip, Math.max(...codigos.values())] as const)
      .sort((a, b) => a[1] - b[1]);

    for (const [ip] of porAntiguedad.slice(0, vistos.size - MAX_IPS)) vistos.delete(ip);
  }
}

/** ¿Puede consultar este código, o ya pidió demasiados distintos? */
export function puedeConsultar(ip: string, codigo: string): boolean {
  const ahora = Date.now();
  limpiar(ahora);

  const clave = codigo.trim().toUpperCase();
  const codigos = vistos.get(ip) ?? new Map<string, number>();
  vistos.set(ip, codigos);

  // Uno que ya miró antes: pasa siempre. Es el que refresca, no el que barre.
  if (codigos.has(clave)) {
    codigos.set(clave, ahora);
    return true;
  }

  if (codigos.size >= CODIGOS_POR_VENTANA) return false;

  codigos.set(clave, ahora);
  return true;
}

/**
 * Busca el envío respetando el freno.
 *
 * Lo usan las dos puertas —la página `/seguimiento/CODIGO` y `/api/track`—
 * para que no quede una abierta. La página consulta dos veces por visita (una
 * para la vista previa de WhatsApp y otra para la pantalla): como se cuentan
 * códigos y no consultas, la segunda no gasta nada.
 */
export async function buscarEnvioConLimite(
  codigo: string,
  headers: Headers,
): Promise<TrackLookup> {
  if (!puedeConsultar(ipDeLaConsulta(headers), codigo ?? '')) {
    return {
      ok: false,
      status: 429,
      error: 'Demasiadas búsquedas seguidas. Esperá un rato y volvé a probar.',
    };
  }

  return buscarEnvio(codigo);
}

/** Sólo para las pruebas: vuelve todo a cero. */
export function reiniciarLimite(): void {
  vistos.clear();
}
