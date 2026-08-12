'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Logo from '@/components/Logo';

const LINKS = [
  { href: '/admin', label: 'Envíos' },
  { href: '/admin/drivers', label: 'Repartidores' },
  { href: '/admin/billing', label: 'Cierre de caja' },
  { href: '/admin/resumenes', label: 'Resúmenes' },
  { href: '/admin/stock', label: 'Stock' },
  { href: '/admin/stats', label: 'Estadísticas' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="border-b border-[var(--edr-border)] bg-[var(--edr-surface)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 sm:gap-x-6 sm:gap-y-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-2 sm:gap-3">
          <Logo size={36} className="sm:h-10 sm:w-10" />
          <div>
            <h1 className="text-base font-black tracking-tight text-[var(--edr-yellow)] sm:text-xl">
              Envíos DosRuedas
            </h1>
            {/* En el teléfono el subtítulo sólo roba una línea de alto. */}
            <p className="hidden text-xs text-[var(--edr-muted)] sm:block">
              Panel de administración
            </p>
          </div>
        </div>

        {/* Las cinco secciones no entran a lo ancho de un celular. En vez de
            apilarlas en tres filas, se deslizan de costado. */}
        <nav className="order-last -mx-3 flex w-[calc(100%+1.5rem)] gap-1 overflow-x-auto px-3 pb-1 sm:order-none sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0 sm:pb-0">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`shrink-0 whitespace-nowrap rounded px-3 py-2 text-sm font-semibold ${
                  active
                    ? 'bg-[var(--edr-blue)] text-white'
                    : 'text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)] hover:text-[var(--edr-yellow)]'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => window.location.reload()}
          title="Actualizar"
          aria-label="Actualizar"
          className="ml-auto rounded border border-[var(--edr-border)] px-3 py-2 text-lg leading-none hover:bg-[var(--edr-surface-2)]"
        >
          ⟳
        </button>

        <Link
          href="/admin/profile"
          className={`rounded border px-3 py-2 text-sm font-semibold ${
            pathname === '/admin/profile'
              ? 'border-[var(--edr-yellow)] text-[var(--edr-yellow)]'
              : 'border-[var(--edr-border)] hover:bg-[var(--edr-surface-2)]'
          }`}
        >
          Mi cuenta
        </Link>

        <button
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/login');
          }}
          className="rounded border border-[var(--edr-border)] px-3 py-2 text-sm hover:bg-[var(--edr-surface-2)]"
        >
          Salir
        </button>
      </div>
    </header>
  );
}
