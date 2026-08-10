import Link from 'next/link';
import Logo from '@/components/Logo';

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <main className="w-full max-w-lg text-center">
        <Logo size={110} full className="mx-auto mb-6 h-auto w-28" />

        <h1 className="text-3xl font-black leading-tight sm:text-4xl">
          Bienvenido al sistema de seguimiento de Envíos DosRuedas
        </h1>
        <p className="mt-3 text-base text-[var(--edr-muted)]">
          Mensajería y logística de última milla en Mar del Plata.
        </p>

        <div className="mt-10 space-y-4">
          <Link
            href="/login"
            className="block rounded-2xl border-2 border-[var(--edr-yellow)] px-6 py-6 text-xl font-black transition hover:bg-[var(--edr-surface)]"
          >
            Ingresar al sistema
            <span className="mt-1 block text-sm font-semibold text-[var(--edr-muted)]">
              Para el equipo de DosRuedas
            </span>
          </Link>

          <Link
            href="/seguimiento"
            className="block rounded-2xl bg-[var(--edr-yellow)] px-6 py-6 text-xl font-black text-black transition hover:brightness-95"
          >
            Realizá el seguimiento de tu envío
            <span className="mt-1 block text-sm font-semibold opacity-75">
              Con el código que empieza con EDR
            </span>
          </Link>
        </div>
      </main>

      <footer className="mt-12 text-center text-xs text-[var(--edr-muted)]">
        <p className="font-bold text-[var(--edr-yellow)]">Envíos DosRuedas</p>
        <p className="edr-mono mt-1">2236602699</p>
        <p className="mt-1">www.enviosdosruedas.com · www.logisticadosruedas.com</p>
      </footer>
    </div>
  );
}
