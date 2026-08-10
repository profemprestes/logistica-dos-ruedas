'use client';

import { useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import ProofOfDelivery, { type TrackResult } from '@/components/ProofOfDelivery';

export default function SeguimientoPage() {
  const [code, setCode] = useState('');
  const [data, setData] = useState<TrackResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function buscar() {
    const limpio = code.trim().toUpperCase();
    if (!limpio) return;

    setLoading(true);
    setError('');
    setData(null);

    try {
      const res = await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: limpio }),
      });
      const json = await res.json();

      if (!res.ok) setError(json.error ?? 'No pudimos consultar el envío.');
      else setData(json as TrackResult);
    } catch {
      setError('No hay conexión. Revisá tu internet y probá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-dvh px-4 py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-6 flex items-center gap-3">
          <Link href="/" className="shrink-0">
            <Logo size={48} />
          </Link>
          <div>
            <h1 className="text-2xl font-black leading-tight">Seguimiento de envío</h1>
            <p className="text-sm text-[var(--edr-muted)]">
              Poné el código que empieza con EDR y te contamos cómo viene.
            </p>
          </div>
        </header>

        <div className="rounded-2xl border-2 border-[var(--edr-yellow)] bg-[var(--edr-surface)] p-5">
          <label className="mb-2 block text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)]">
            Código de seguimiento
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buscar()}
              placeholder="EDR00001015MDQ"
              autoCapitalize="characters"
              className="edr-mono min-w-0 flex-1 rounded-xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-4 py-4 text-lg uppercase outline-none focus:border-[var(--edr-yellow)]"
            />
            <button
              onClick={buscar}
              disabled={loading || !code.trim()}
              className="rounded-xl bg-[var(--edr-yellow)] px-8 py-4 text-lg font-black text-black disabled:opacity-50"
            >
              {loading ? 'Buscando…' : 'Buscar'}
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-xl bg-red-600 px-4 py-3 text-center text-base font-bold text-white">
              {error}
            </p>
          )}
        </div>

        {data && (
          <div className="mt-6 space-y-4">
            <ProofOfDelivery data={data} />

            <button
              onClick={() => {
                setData(null);
                setCode('');
                setError('');
              }}
              className="w-full rounded-xl border-2 border-[var(--edr-yellow)] px-6 py-4 text-lg font-black hover:bg-[var(--edr-surface)]"
            >
              ← Buscar otro envío
            </button>
          </div>
        )}

        {/* La web principal es donde se cotiza y se contrata: se promociona
            siempre, haya resultado o no. */}
        <a
          href="https://www.enviosdosruedas.com"
          target="_blank"
          rel="noreferrer"
          className="mt-6 block rounded-2xl bg-[var(--edr-yellow)] px-6 py-5 text-center text-black transition hover:brightness-95"
        >
          <span className="block text-lg font-black">¿Necesitás enviar algo?</span>
          <span className="mt-1 block text-sm font-bold">
            Cotizá tu envío y conocé todos nuestros servicios en enviosdosruedas.com →
          </span>
        </a>

        <p className="mt-8 text-center text-xs text-[var(--edr-muted)]">
          ¿Sos parte del equipo?{' '}
          <Link href="/login" className="font-bold text-[var(--edr-yellow)] underline">
            Entrá al sistema
          </Link>
        </p>
      </div>
    </div>
  );
}
