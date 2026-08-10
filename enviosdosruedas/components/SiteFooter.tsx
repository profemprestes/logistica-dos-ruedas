/**
 * Pie institucional. Vive en un solo lugar para que la portada, el seguimiento
 * y el comprobante digan exactamente lo mismo.
 *
 * La jerarquía es a propósito: enviosdosruedas.com es la web comercial donde se
 * cotiza y se contrata, así que va grande; logisticadosruedas.com es el dominio
 * de este sistema y va como dato secundario.
 */
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

      <a href="tel:2236602699" className="edr-mono mt-2 block text-base font-bold">
        2236602699
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
