'use client';

/**
 * Dónde queda, de un vistazo.
 *
 * No reemplaza al "Cómo llegar": es para que el repartidor entienda EN QUÉ ZONA
 * está el punto sin salir de la app —si es por el puerto, si es en Constitución—
 * y pueda ordenar la vuelta. Para navegar sigue abriendo Google Maps, que es lo
 * que sabe hacer eso.
 *
 * Va con el mapa de OpenStreetMap, el mismo que ya usa el comprobante de
 * entrega: no necesita clave ni cuenta con tarjeta.
 *
 * Si el envío no tiene coordenadas no se dibuja nada. Eso pasa cuando el
 * buscador de direcciones no estuvo seguro, y es a propósito: un pin en la
 * cuadra equivocada es peor que ningún pin, porque el repartidor le cree.
 */
export default function MiniMapa({
  lat,
  lng,
  alto = 150,
}: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  alto?: number;
}) {
  if (lat == null || lng == null) return null;

  // Ventana de unos 700 m de lado: se ve la cuadra y las calles de alrededor.
  const d = 0.004;
  const src =
    `https://www.openstreetmap.org/export/embed.html` +
    `?bbox=${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}` +
    `&layer=mapnik&marker=${lat}%2C${lng}`;

  return (
    <div>
      <iframe
        src={src}
        title="Punto de entrega"
        loading="lazy"
        style={{ height: alto }}
        className="w-full rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface-2)]"
      />
      <p className="mt-1 text-center text-xs font-semibold text-[var(--edr-muted)]">
        Referencia aproximada · para navegar usá &ldquo;Cómo llegar&rdquo;
      </p>
    </div>
  );
}
