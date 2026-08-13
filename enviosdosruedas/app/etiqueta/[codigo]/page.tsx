import type { Metadata } from 'next';
import { createClient } from '@supabase/supabase-js';
import Link from 'next/link';
import Logo from '@/components/Logo';
import EtiquetaImprimible from '@/components/EtiquetaImprimible';
import { etiquetaFirmada } from '@/lib/etiquetaFirma';
import { CODE_RE } from '@/lib/trackServer';
import type { Shipment } from '@/lib/format';

/**
 * La etiqueta de un envío, para que la imprima el comercio.
 *
 *   logisticadosruedas.com/etiqueta/EDR00001059MDQ?t=firma
 *
 * SIN LA FIRMA NO SE MUESTRA NADA. Acá adentro hay teléfono del destinatario y
 * monto a cobrar —los dos datos que el seguimiento público esconde— y los
 * códigos son correlativos: sin firma, esta dirección sería una lista de
 * teléfonos ordenada por número de envío.
 */

export const dynamic = 'force-dynamic';

/**
 * Nada de vista previa.
 *
 * El link se pega en WhatsApp y la vista previa la ve cualquiera que esté en la
 * conversación, incluido un grupo. Una etiqueta con nombre, dirección y monto
 * no tiene por qué asomarse ahí.
 */
export const metadata: Metadata = {
  title: 'Etiqueta · Envíos DosRuedas',
  robots: { index: false, follow: false },
};

async function buscarParaEtiqueta(codigo: string): Promise<Shipment | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data } = await admin
    .from('shipments')
    .select('*')
    .eq('tracking_code', codigo.trim().toUpperCase())
    .maybeSingle();

  return (data as Shipment | null) ?? null;
}

export default async function EtiquetaPage({
  params,
  searchParams,
}: {
  params: Promise<{ codigo: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { codigo } = await params;
  const { t } = await searchParams;

  const valido = CODE_RE.test(codigo ?? '') && etiquetaFirmada(codigo, t ?? '');
  const envio = valido ? await buscarParaEtiqueta(codigo) : null;

  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          <Link href="/" className="shrink-0">
            <Logo size={44} />
          </Link>
          <div>
            <div className="text-lg font-black leading-tight">Envíos DosRuedas</div>
            <div className="text-xs font-semibold uppercase tracking-widest text-[var(--edr-muted)]">
              Etiqueta del envío
            </div>
          </div>
        </header>

        {!envio ? (
          /* El mismo mensaje para un link mal firmado que para uno inexistente:
             decir "la firma no es válida" le confirmaría a quien esté probando
             que el envío existe. */
          <div className="rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-8 text-center">
            <p className="text-lg font-black">No pudimos abrir esta etiqueta</p>
            <p className="mt-2 text-sm text-[var(--edr-muted)]">
              El link puede estar incompleto o vencido. Pedile a Envíos DosRuedas que te lo
              mande de nuevo.
            </p>
            <Link
              href="/"
              className="mt-4 inline-block rounded border border-[var(--edr-border)] px-4 py-2 text-sm font-bold"
            >
              Ir al inicio
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-xl border border-[var(--edr-border)] bg-[var(--edr-surface)] px-4 py-3">
              <div className="edr-mono text-xs text-[var(--edr-muted)]">{envio.tracking_code}</div>
              <div className="text-lg font-bold">{envio.address_street}</div>
              <div className="text-sm text-[var(--edr-muted)]">
                {envio.recipient_name} · {envio.city}
              </div>
            </div>

            <EtiquetaImprimible shipment={envio} />
          </>
        )}
      </div>
    </div>
  );
}
