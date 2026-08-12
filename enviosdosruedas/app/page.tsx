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

/** Quiénes entran por el login, para que nadie dude si es su puerta. */
const QUIENES = [
  { icono: '🗂️', titulo: 'Administración', detalle: 'Envíos, cierre de caja, stock y estadísticas' },
  { icono: '🛵', titulo: 'Repartidores', detalle: 'Hoja de ruta, escaneo y cierre de entregas' },
  { icono: '🏬', titulo: 'Comercios', detalle: 'Stock en depósito, y más cosas en camino' },
];

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* ---------- Encabezado ---------- */}
      <header className="border-b border-[var(--edr-border)]">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-5 py-4">
          <Logo size={44} />
          <span className="text-lg font-black tracking-tight">Envíos DosRuedas</span>

          <a
            href="https://www.enviosdosruedas.com"
            target="_blank"
            rel="noreferrer"
            className="ml-auto rounded-full border border-[var(--edr-yellow)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--edr-yellow)] transition hover:bg-[var(--edr-surface)]"
          >
            Ir a la web ↗
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:py-14">
        {/* ---------- Titular ---------- */}
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--edr-yellow)]">
          Plataforma de operaciones
        </p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-tighter sm:text-6xl">
          Seguimiento y gestión
          <br />
          de envíos
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-[var(--edr-muted)] sm:text-lg">
          Este es el sistema con el que trabajamos los envíos: acá seguís tu paquete y entra el
          equipo. Si querés <strong className="text-white">cotizar un envío o conocer los servicios</strong>,
          eso está en nuestra web{' '}
          <a
            href="https://www.enviosdosruedas.com"
            target="_blank"
            rel="noreferrer"
            className="font-bold text-[var(--edr-yellow)] underline decoration-2 underline-offset-4"
          >
            enviosdosruedas.com
          </a>
          .
        </p>

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

        {/* ---------- Acceso ---------- */}
        <section className="mt-8 rounded-3xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--edr-muted)]">
            Para el equipo y nuestros comercios
          </p>
          <h2 className="mt-2 text-2xl font-black uppercase tracking-tight sm:text-3xl">
            Entrar al sistema
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-[var(--edr-muted)]">
            Una sola puerta para todos: entrás con tu usuario y el sistema te lleva a tu pantalla.
          </p>

          <ul className="mt-6 grid gap-3 sm:grid-cols-3">
            {QUIENES.map((q) => (
              <li
                key={q.titulo}
                className="rounded-2xl border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-4 py-4"
              >
                <span className="text-2xl leading-none">{q.icono}</span>
                <div className="mt-2 text-base font-black uppercase tracking-tight">{q.titulo}</div>
                <div className="mt-1 text-xs leading-snug text-[var(--edr-muted)]">{q.detalle}</div>
              </li>
            ))}
          </ul>

          <Link
            href="/login"
            className="mt-6 inline-block rounded-full bg-[var(--edr-yellow)] px-8 py-4 text-lg font-black uppercase tracking-wide text-[var(--edr-blue-dark)] transition hover:brightness-95"
          >
            Ingresar
          </Link>
        </section>

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
