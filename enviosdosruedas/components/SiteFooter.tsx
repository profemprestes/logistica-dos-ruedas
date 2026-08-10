/**
 * Pie institucional. Vive en un solo lugar para que la portada, el seguimiento
 * y el comprobante digan exactamente lo mismo.
 *
 * La jerarquía es a propósito: enviosdosruedas.com es la web comercial donde se
 * cotiza y se contrata, así que va grande; logisticadosruedas.com es el dominio
 * de este sistema y va como dato secundario.
 */
/** 2236602699 en formato internacional, que es lo que pide wa.me. */
const WHATSAPP = '5492236602699';

export default function SiteFooter({ compacto = false }: { compacto?: boolean }) {
  const anio = new Date().getFullYear();

  return (
    <div className="text-center">
      <a
        href="https://www.enviosdosruedas.com"
        target="_blank"
        rel="noreferrer"
        className={`block font-black text-[var(--edr-yellow)] underline decoration-2 underline-offset-4 ${
          compacto ? 'text-lg' : 'text-xl sm:text-2xl'
        }`}
      >
        www.enviosdosruedas.com
      </a>

      {/* El teléfono abre WhatsApp, no el marcador: es por donde llega la
          consulta y queda la conversación escrita. */}
      <a
        href={`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
          '¡Hola! Quiero consultar por un envío.',
        )}`}
        target="_blank"
        rel="noreferrer"
        className="edr-mono mt-2 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-base font-bold text-white"
      >
        💬 2236602699
      </a>

      <a
        href="https://www.logisticadosruedas.com"
        target="_blank"
        rel="noreferrer"
        className="mt-1 block text-[11px] text-[var(--edr-muted)] underline"
      >
        www.logisticadosruedas.com
      </a>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--edr-muted)]">
        Diseñado por Envíos DosRuedas · Todos los derechos reservados © {anio}
        <br />
        Mensajería y logística de última milla · Mar del Plata, Argentina
      </p>
    </div>
  );
}
