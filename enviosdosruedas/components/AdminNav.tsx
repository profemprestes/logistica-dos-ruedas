'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import Logo from '@/components/Logo';

const LINKS = [
  { href: '/admin', label: 'Envíos' },
  { href: '/admin/drivers', label: 'Repartidores' },
  { href: '/admin/billing', label: 'Cierre de caja' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="border-b border-[var(--edr-border)] bg-[var(--edr-surface)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="text-xl font-black tracking-tight text-[var(--edr-yellow)]">
              Envíos DosRuedas
            </h1>
            <p className="text-xs text-[var(--edr-muted)]">Panel de administración</p>
          </div>
        </div>

        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded px-3 py-2 text-sm font-semibold ${
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
