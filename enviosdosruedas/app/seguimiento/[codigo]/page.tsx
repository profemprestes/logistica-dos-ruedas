import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import Logo from '@/components/Logo';
import ProofOfDelivery from '@/components/ProofOfDelivery';
import SiteFooter from '@/components/SiteFooter';
import { buscarEnvioConLimite } from '@/lib/trackLimite';
import { STATUS_LABEL, type ShipmentStatus } from '@/lib/format';

/**
 * Seguimiento con el código en la dirección:
 *   logisticadosruedas.com/seguimiento/EDR00001015MDQ
 *
 * Es un componente de servidor a propósito. Resolviéndolo acá, el que abre el
 * link ve el estado en la primera pantalla —sin formulario ni espera— y, sobre
 * todo, WhatsApp puede armar la vista previa del link, que sale de las etiquetas
 * del HTML y no existiría si esto se buscara desde el navegador.
 */

export const dynamic = 'force-dynamic';

/**
 * La vista previa dice el estado y nada más.
 *
 * Ojo: esto lo ve cualquiera que esté en la conversación donde se pegue el
 * link, incluido un grupo. Por eso NO va el nombre del destinatario ni la
 * dirección, aunque sí estén dentro de la página.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ codigo: string }>;
}): Promise<Metadata> {
  const { codigo } = await params;
  const r = await buscarEnvioConLimite(codigo, await headers());

  if (!r.ok) {
    return { title: 'Seguimiento · Envíos DosRuedas' };
  }

  /*
   * El mismo orden que la tarjeta de adentro: primero lo que el envío ES.
   *
   * Antes mandaba el último movimiento, y eso hacía que un envío cancelado
   * después de un intento fallido dijera "No se pudo entregar" en el título y
   * "CANCELADO" adentro. Se nota ahora que cancelar un no entregado es una
   * decisión de todos los días, y se nota donde peor cae: el título es lo que
   * se ve en la vista previa de WhatsApp, o sea lo que lee el destinatario
   * antes de abrir nada.
   */
  const estado =
    r.data.status === 'cancelado'
      ? 'Cancelado'
      : r.data.status === 'entregado' || r.data.proof?.event === 'entregado'
        ? 'Entregado'
        : r.data.proof?.event === 'no_entregado'
          ? 'No se pudo entregar'
          : (STATUS_LABEL[r.data.status as ShipmentStatus] ?? 'En curso');

  return {
    title: `${r.data.code} · ${estado} · Envíos DosRuedas`,
    description: `Seguimiento del envío ${r.data.code}: ${estado}. Mensajería y logística en ${r.data.city}.`,
    openGraph: {
      title: `Tu envío: ${estado}`,
      description: `Código ${r.data.code} · Envíos DosRuedas`,
      type: 'website',
    },
  };
}

export default async function SeguimientoPorCodigoPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const resultado = await buscarEnvioConLimite(codigo, await headers());

  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-center gap-3">
          <Link href="/" className="shrink-0">
            <Logo size={48} />
          </Link>
          <div className="min-w-0">
            <h1 className="font-anton text-2xl uppercase leading-tight tracking-[-.02em]">
              Seguimiento de envío
            </h1>
            <p className="edr-mono truncate text-sm text-[var(--edr-muted)]">
              {decodeURIComponent(codigo).toUpperCase()}
            </p>
          </div>
        </header>

        {resultado.ok ? (
          <ProofOfDelivery data={resultado.data} />
        ) : (
          <div className="rounded-2xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-6 text-center">
            <p className="text-lg font-black">{resultado.error}</p>
            <p className="mt-2 text-sm text-[var(--edr-muted)]">
              Si el envío es muy reciente puede tardar unos minutos en aparecer.
            </p>
            <Link
              href="/seguimiento"
              className="mt-5 inline-block rounded-xl border-2 border-[var(--edr-yellow)] px-6 py-3 text-base font-black hover:bg-[var(--edr-surface-2)]"
            >
              Buscar con otro código
            </Link>
          </div>
        )}

        {resultado.ok && (
          <Link
            href="/seguimiento"
            className="mt-4 block w-full rounded-xl border-2 border-[var(--edr-yellow)] px-6 py-4 text-center text-lg font-black hover:bg-[var(--edr-surface)]"
          >
            ← Buscar otro envío
          </Link>
        )}

        {/* La web principal es donde se cotiza y se contrata: se promociona
            siempre, haya resultado o no. */}
        <a
          href="https://www.enviosdosruedas.com"
          target="_blank"
          rel="noreferrer"
          className="mt-6 block rounded-2xl bg-[var(--edr-yellow)] px-6 py-5 text-center text-[var(--edr-blue)] transition hover:brightness-95"
        >
          <span className="block font-anton text-xl uppercase tracking-[-.01em]">
            ¿Necesitás enviar algo?
          </span>
          <span className="mt-1 block text-sm font-bold">
            Cotizá tu envío y conocé todos nuestros servicios en enviosdosruedas.com →
          </span>
        </a>

        <footer className="mt-10 border-t border-[var(--edr-border)] pt-6">
          <SiteFooter />
        </footer>
      </div>
    </div>
  );
}
