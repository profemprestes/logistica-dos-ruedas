import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Bike, Store } from 'lucide-react';
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
          {/* El nombre en dos colores, como en la app: es la firma de la marca
              y hace que la portada y la pantalla del repartidor se reconozcan
              como la misma cosa. */}
          <span className="font-anton text-lg uppercase leading-[.9] tracking-[-.01em] text-white">
            Envíos<span className="text-[var(--edr-yellow)]">DosRuedas</span>
          </span>

          {/* El ingreso vive acá arriba, como una pestaña más: el que entra ya
              sabe quién es y no necesita que se lo expliquen. */}
          <nav className="ml-auto flex items-center gap-2">
            <a
              href="https://www.enviosdosruedas.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-full border border-[var(--edr-border)] px-4 py-2 font-bebas text-sm tracking-[.06em] text-[var(--edr-muted)] transition hover:bg-[var(--edr-surface)] hover:text-[var(--edr-yellow)]"
            >
              IR A LA WEB
              <ArrowUpRight size={14} strokeWidth={2.5} />
            </a>
            <Link
              href="/login"
              className="rounded-full bg-[var(--edr-yellow)] px-5 py-2.5 font-bebas text-sm tracking-[.06em] text-[var(--edr-blue)] transition hover:brightness-95"
            >
              INGRESAR
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 sm:py-14">
        {/* ---------- Titular ---------- */}
        <p className="font-bebas text-sm tracking-[.12em] text-[var(--edr-yellow)]">
          MAR DEL PLATA · MENSAJERÍA Y LOGÍSTICA
        </p>
        <h1 className="mt-3 font-anton text-[40px] uppercase leading-[0.92] tracking-[-.02em] sm:text-6xl">
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
              className="rounded-full border border-[var(--edr-border)] px-4 py-1.5 font-bebas text-sm tracking-[.07em] text-[var(--edr-muted)]"
            >
              {p.toUpperCase()}
            </li>
          ))}
        </ul>

        {/* ---------- Seguimiento ---------- */}
        {/* Sobre amarillo el texto es siempre el azul de la marca. */}
        <section className="mt-10 rounded-3xl bg-[var(--edr-yellow)] p-6 text-[var(--edr-blue)] shadow-[var(--edr-sombra)] sm:p-8">
          <p className="font-bebas text-sm tracking-[.12em] opacity-75">
            PARA VOS, QUE ESTÁS ESPERANDO UN PAQUETE
          </p>
          <h2 className="mt-2 font-anton text-3xl uppercase leading-none tracking-[-.02em] sm:text-4xl">
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
            Dos puertas y no una.

            La puerta es la misma —el mismo usuario, la misma contraseña, y el
            sistema lleva a cada uno a lo suyo por su rol— pero el que llega no
            tiene por qué saberlo. Un repartidor y un comercio buscan cosas
            distintas, y "INGRESAR" a secas no le confirma a ninguno de los dos
            que esté en el lugar correcto. Con el nombre puesto, sí.

            El admin no tiene la suya a propósito: es una persona, ya sabe que
            entra por cualquiera de las dos, y una tercera puerta sólo agregaría
            ruido para el resto.

            Está acá abajo además del botón del encabezado porque en el celular
            la portada se scrollea y nadie vuelve arriba. */}
        <section className="mt-8">
          <h2 className="font-bebas text-sm tracking-[.12em] text-[var(--edr-muted)]">
            ¿TENÉS USUARIO DEL SISTEMA?
          </h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Puerta href="/login?como=repartidor" Icono={Bike} titulo="Ingreso repartidores" />
            <Puerta href="/login?como=comercio" Icono={Store} titulo="Ingreso comercios" />
          </div>
        </section>

        {/* ---------- Web comercial ---------- */}
        <a
          href="https://www.enviosdosruedas.com"
          target="_blank"
          rel="noreferrer"
          className="mt-8 block rounded-3xl border-2 border-[var(--edr-yellow)] px-6 py-6 text-center transition hover:bg-[var(--edr-surface)] sm:px-8"
        >
          <p className="font-bebas text-sm tracking-[.12em] text-[var(--edr-muted)]">
            ¿TODAVÍA NO SOS CLIENTE?
          </p>
          <p className="mt-2 font-anton text-2xl uppercase leading-tight tracking-[-.02em] sm:text-3xl">
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

/**
 * Una de las dos puertas.
 *
 * El nombre y nada más. Es un botón para el que ya sabe quién es: explicarle
 * qué va a encontrar adentro sería explicarle su propio trabajo.
 */
function Puerta({ href, Icono, titulo }: { href: string; Icono: typeof Bike; titulo: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-3xl border-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-5 py-4 transition hover:border-[var(--edr-yellow)]"
    >
      <span className="shrink-0 rounded-full bg-[var(--edr-yellow)] p-2.5 text-[var(--edr-blue)]">
        <Icono size={22} strokeWidth={2.5} />
      </span>
      <span className="font-bebas text-xl uppercase leading-none tracking-[.05em] text-[var(--edr-yellow)]">
        {titulo}
      </span>
      <ArrowUpRight
        size={18}
        strokeWidth={2.5}
        className="ml-auto shrink-0 text-[var(--edr-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--edr-yellow)]"
      />
    </Link>
  );
}
