'use client';

/**
 * Si la oficina lo está viendo, dicho en la pantalla del repartidor.
 *
 * POR QUÉ EXISTE. El 18/08/2026 un repartidor salió con la app instalada, los
 * permisos dados y todo en orden, y estuvo 107 minutos sin mandar una sola
 * posición: mandaba con la app en pantalla y se callaba al guardar el teléfono.
 * Desde la oficina se veía igual que "no anda el GPS", y desde el celular no se
 * veía nada: la app se veía impecable. La única pista era un cartelito de error
 * que duraba tres segundos y que nadie llegó a ver.
 *
 * LO QUE MUESTRA ES EL RESULTADO, NO LA INTENCIÓN. No dice "el GPS está
 * prendido" —eso ya lo decía y era verdad, y sin embargo la oficina no lo veía—
 * sino hace cuánto el servidor aceptó la última posición. Es el único número
 * que significa algo, porque es el mismo que mira la oficina.
 *
 * Y DISTINGUE LOS DOS MODOS, que es lo que costó una mañana entender:
 *
 *   · "de fondo": el servicio de Android está corriendo. Puede guardar el
 *     teléfono y la oficina lo sigue viendo.
 *   · "sólo con la app abierta": no arrancó el servicio —o entró desde el
 *     navegador— así que al guardar el teléfono deja de mandar. No es un
 *     error, pero él tiene que saberlo.
 *   · "roto": el GPS devolvió un error concreto. Se muestra el motivo.
 */
import { useEffect, useState } from 'react';
import { MapPin, MapPinOff } from 'lucide-react';
import { estadoGpsNativo, type EstadoGps } from '@/lib/driver/nativo';
import { segundosDesdeLaUltima } from '@/lib/driver/posicion';

/**
 * A partir de acá el silencio deja de ser normal.
 *
 * El latido es de 30 segundos. Dos minutos son cuatro latidos perdidos: ya no
 * es "justo se cruzó un semáforo", es que algo dejó de andar.
 */
const SILENCIO_MALO = 120;

function haceCuanto(seg: number): string {
  if (seg < 60) return `hace ${seg} seg`;
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h ${min % 60} min`;
}

export default function EstadoUbicacion({ conectado }: { conectado: boolean }) {
  const [gps, setGps] = useState<EstadoGps>({ modo: 'pantalla' });
  const [seg, setSeg] = useState<number | null>(null);

  useEffect(() => {
    if (!conectado) return;

    const mirar = () => {
      setGps(estadoGpsNativo());
      setSeg(segundosDesdeLaUltima());
    };

    mirar();
    // Cada cinco segundos: es un texto que se mira de reojo mientras se maneja,
    // y uno que tarda medio minuto en actualizarse no sirve para darse cuenta
    // de nada.
    const t = window.setInterval(mirar, 5_000);
    return () => window.clearInterval(t);
  }, [conectado]);

  // Desconectado no se manda nada, y eso ya lo dice el botón de al lado.
  // Repetirlo acá sería un cartel de alarma para algo que él mismo decidió.
  if (!conectado) return null;

  const mudo = seg === null || seg > SILENCIO_MALO;
  const roto = gps.modo === 'roto';
  const soloEnPantalla = gps.modo === 'pantalla';

  const color = roto || mudo ? 'var(--edr-rojo-claro)' : soloEnPantalla ? '#fbbf24' : 'var(--edr-verde-claro)';

  const texto = roto
    ? `GPS CON PROBLEMA: ${gps.motivo}`
    : seg === null
      ? 'TODAVÍA NO MANDÓ NINGUNA UBICACIÓN'
      : soloEnPantalla
        ? `TE VEN ${haceCuanto(seg).toUpperCase()} · SÓLO CON LA APP ABIERTA`
        : `TE VEN ${haceCuanto(seg).toUpperCase()} · TAMBIÉN DE FONDO`;

  return (
    <div
      className="flex items-center gap-1.5 px-3.5 pb-1.5 pt-0.5 font-bebas text-[13px] leading-tight tracking-[.06em]"
      style={{ color }}
    >
      {roto || mudo ? (
        <MapPinOff size={13} strokeWidth={2.5} className="shrink-0" />
      ) : (
        <MapPin size={13} strokeWidth={2.5} className="shrink-0" />
      )}
      <span className="min-w-0">{texto}</span>
    </div>
  );
}
