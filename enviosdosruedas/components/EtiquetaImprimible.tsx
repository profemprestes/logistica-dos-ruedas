'use client';

import PrintPortal from '@/components/PrintPortal';
import ShippingLabel from '@/components/ShippingLabel';
import type { Shipment } from '@/lib/format';

/**
 * La etiqueta lista para imprimir o guardar, para quien abre el link.
 *
 * Se dibuja DOS veces a propósito: una a la vista, para que se sepa qué se está
 * por imprimir, y otra dentro del portal de impresión. La hoja de estilos
 * esconde todo lo que no esté en ese portal cuando se imprime, así que la copia
 * de pantalla no sale en el papel y la del portal no se ve en pantalla. Es un
 * componente puro: dibujarlo dos veces no cuesta nada.
 */
export default function EtiquetaImprimible({ shipment }: { shipment: Shipment }) {
  return (
    <>
      <button
        onClick={() => window.print()}
        className="w-full rounded-xl bg-[var(--edr-yellow)] px-5 py-4 text-lg font-black text-black hover:brightness-95"
      >
        🖨 Imprimir o guardar en PDF
      </button>

      <p className="mt-2 text-center text-xs text-[var(--edr-muted)]">
        En el cuadro de impresión, elegí &quot;Guardar como PDF&quot; si querés el archivo.
      </p>

      {/* La vista previa: fondo blanco y borde, para que se vea el papel. */}
      <div className="mt-4 flex justify-center">
        <div className="overflow-hidden rounded-lg border-2 border-[var(--edr-border)] bg-white">
          <ShippingLabel shipment={shipment} />
        </div>
      </div>

      <PrintPortal>
        <ShippingLabel shipment={shipment} />
      </PrintPortal>
    </>
  );
}
