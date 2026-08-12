import { NextResponse } from 'next/server';
import { buscarEnvio } from '@/lib/trackServer';

/**
 * Seguimiento público de un envío por su código EDR.
 *
 * La consulta vive en `lib/trackServer.ts`, compartida con la página
 * `/seguimiento/CODIGO`: así las dos puertas cuentan exactamente lo mismo y
 * filtran los mismos campos.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const resultado = await buscarEnvio(body.code ?? '');

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }

  return NextResponse.json(resultado.data);
}
