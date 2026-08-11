import type { Shipment } from '@/lib/format';

/**
 * Envíos cargados para otro día.
 *
 * El repartidor los ve en una sección aparte pero no los puede tocar hasta la
 * fecha: ni escanear, ni retirar, ni entregar. El candado de verdad está en la
 * base (paso 14) — esto es para que no llegue a intentarlo y para explicarle
 * por qué, que es lo que la base sola no puede hacer.
 */

/** Hoy en hora local, no UTC: de noche, UTC ya está en el día siguiente. */
export function hoyLocal(): string {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function esProgramado(s: Shipment, hoy = hoyLocal()): boolean {
  return Boolean(s.scheduled_date) && s.scheduled_date > hoy;
}

/** "mañana", "el jueves", "el 25/08": cómo nombrar el día que falta. */
export function cuandoSeHace(fechaISO: string, hoy = hoyLocal()): string {
  const dias = Math.round(
    (Date.parse(`${fechaISO}T00:00:00`) - Date.parse(`${hoy}T00:00:00`)) / 86_400_000,
  );

  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'mañana';

  if (dias < 7) {
    const nombre = new Date(`${fechaISO}T00:00:00`).toLocaleDateString('es-AR', {
      weekday: 'long',
    });
    return `el ${nombre}`;
  }

  return `el ${fechaISO.split('-').reverse().slice(0, 2).join('/')}`;
}

/** Separa la hoja de ruta en lo de hoy y lo que todavía no se puede hacer. */
export function partirRuta(rows: Shipment[], hoy = hoyLocal()) {
  const deHoy: Shipment[] = [];
  const proximos: Shipment[] = [];

  for (const s of rows) (esProgramado(s, hoy) ? proximos : deHoy).push(s);

  // Los próximos, por fecha: primero lo que se hace antes.
  proximos.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));

  return { deHoy, proximos };
}
