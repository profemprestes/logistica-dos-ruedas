import type { Metadata } from 'next';
import Link from 'next/link';
import Logo from '@/components/Logo';
import SiteFooter from '@/components/SiteFooter';
import TrackBox from '@/components/TrackBox';

/**
 * Portada del sistema.
 *
 * Toma prestado el aire de www.enviosdosruedas.com —la misma tipografía Outfit,
 * títulos en mayúscula con el interletrado apretado, botones tipo píldora y el
 * amarillo como color de acción— pero deja claro que esto NO es esa página:
 * acá se sigue un envío y se entra al sistema. Cotizar y contratar es allá, y
 * por eso el link a la web comercial aparece arriba y abajo.
 */

export const metadata: Metadata = {
  title: 'Seguimiento y gestión de envíos · Envíos DosRuedas',
  description:
    'Seguí tu envío con el código EDR y accedé al sistema de gestión de Envíos DosRuedas. Mensajería y logística de última milla en Mar del Plata.',
};

/**
 * Las pastillas de la web comercial, que son las que plantan el "acá estamos".
 * Sin ellas la portada podía ser la de cualquier empresa de cualquier lado.
 */
const PASTILLAS = ['100% marplatense', 'Envíos en el día', 'Cobertura Gral. Pueyrredón'];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* ---------- Encabezado ---------- */}
      <header className="border-b border-[var(--edr-border)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-4">
          <Logo size={44} />
          <span className="text-lg font-black tracking-tight">Envíos DosRuedas</span>

          {/* El ingreso vive acá arriba, como una pestaña más: el que entra ya
              sabe quién es y no necesita que se lo expliquen. */}
          <nav className="ml-auto flex items-center gap-2">
            <a
              href="https://www.enviosdosruedas.com"
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-[var(--edr-border)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)] transition hover:bg-[var(--edr-surface)] hover:text-[var(--edr-yellow)]"
            >
              Ir a la web ↗
            </a>
            <Link
              href="/login"
              className="rounded-full bg-[var(--edr-yellow)] px-5 py-2.5 text-xs font-black uppercase tracking-wide text-[var(--edr-blue-dark)] transition hover:brightness-95"
            >
              Ingresar
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:py-14">
        {/* ---------- Titular ---------- */}
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--edr-yellow)]">
          Mar del Plata · Mensajería y logística
        </p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-tighter sm:text-6xl">
          Seguimiento y gestión
          <br />
          de envíos
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--edr-muted)] sm:text-lg">
          Este es nuestro sistema de seguimiento, diseñado por Envíos DosRuedas y de uso exclusivo.
          Para conocer nuestros servicios o cotizar envíos, entrá a nuestra página principal{' '}
          <a
            href="https://www.enviosdosruedas.com"
            target="_blank"
            rel="noreferrer"
            className="font-bold text-[var(--edr-yellow)] underline decoration-2 underline-offset-4"
          >
            www.enviosdosruedas.com
          </a>
          .
        </p>

        <ul className="mt-6 flex flex-wrap gap-2">
          {PASTILLAS.map((p) => (
            <li
              key={p}
              className="rounded-full border border-[var(--edr-border)] px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--edr-muted)]"
            >
              {p}
            </li>
          ))}
        </ul>

        {/* ---------- Seguimiento ---------- */}
        <section className="mt-10 rounded-3xl bg-[var(--edr-yellow)] p-6 text-[var(--edr-blue-dark)] sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-70">
            Para vos, que estás esperando un paquete
          </p>
          <h2 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Seguí tu envío
          </h2>
          <p className="mt-2 text-sm font-semibold opacity-80">
            Poné el código que empieza con EDR. Está en la etiqueta del paquete y en el mensaje que
            te mandó el comercio.
          </p>

          <div className="mt-5">
            <TrackBox />
          </div>
        </section>

        {/* ---------- Acceso ----------
            Una línea y listo. El que tiene usuario ya sabe qué es esto; el que
            no lo tiene, no le sirve que se lo expliquen. Está acá abajo además
            del botón de arriba porque en el celular la portada se scrollea y
            nadie vuelve al encabezado. */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-3xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-6 py-5">
          <span className="text-base font-bold">¿Tenés usuario del sistema?</span>
          <Link
            href="/login"
            className="rounded-full bg-[var(--edr-yellow)] px-8 py-3 text-base font-black uppercase tracking-wide text-[var(--edr-blue-dark)] transition hover:brightness-95"
          >
            Ingresar
          </Link>
        </div>

        {/* ---------- Web comercial ---------- */}
        <a
          href="https://www.enviosdosruedas.com"
          target="_blank"
          rel="noreferrer"
          className="mt-8 block rounded-3xl border-2 border-[var(--edr-yellow)] px-6 py-6 text-center transition hover:bg-[var(--edr-surface)] sm:px-8"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--edr-muted)]">
            ¿Todavía no sos cliente?
          </p>
          <p className="mt-2 text-xl font-black uppercase tracking-tight sm:text-2xl">
            Cotizá tu envío en enviosdosruedas.com
          </p>
          <p className="mt-2 text-sm font-semibold text-[var(--edr-muted)]">
            Mensajería, envíos en el día, Flex y logística para e-commerce en Mar del Plata →
          </p>
        </a>
      </main>

      <footer className="border-t border-[var(--edr-border)] px-5 py-8">
        <div className="mx-auto max-w-5xl">
          <SiteFooter />
        </div>
      </footer>
    </div>
  );
}
