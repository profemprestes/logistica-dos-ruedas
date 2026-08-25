'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Calendar,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  MessageCircle,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  Receipt,
  Store,
  Users,
  PiggyBank,
  HandCoins,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import Logo from '@/components/Logo';
import { supabase } from '@/lib/supabaseClient';
import { diaDeHoyAR } from '@/lib/format';
import { cerrandoParaNavegar, useCerrarConAtras } from '@/lib/driver/useAtras';
import { useDatosDelDia } from '@/components/admin/DatosDelDia';

/**
 * El marco del panel: la columna de la izquierda y la barra de arriba.
 *
 * Antes las secciones estaban en una fila de pestañas que en el teléfono había
 * que deslizar de costado, así que las últimas —stock, estadísticas— existían
 * pero no se veían. En una columna entran las nueve de una, y queda lugar
 * arriba para lo único que se usa cien veces por día: buscar un paquete y
 * cargar uno nuevo.
 *
 * En el celular la columna se esconde y aparece como cajón, con una barra de
 * abajo para las cuatro secciones de siempre. El panel se usa desde el
 * teléfono —el cierre de caja lo hace el admin esté donde esté— así que ni una
 * sección puede quedar fuera de alcance.
 */

interface Item {
  href: string;
  label: string;
  Icono: typeof Package;
  /** Cómo se llama en la barra de abajo del celular, donde no entra el largo. */
  corto?: string;
}

const ITEMS: Item[] = [
  { href: '/admin/panel', label: 'Panel del día', Icono: LayoutDashboard, corto: 'PANEL' },
  { href: '/admin', label: 'Envíos', Icono: Package, corto: 'ENVÍOS' },
  { href: '/admin/mapa', label: 'Mapa en vivo', Icono: MapIcon, corto: 'MAPA' },
  /*
   * "Usuarios" y no "Repartidores": la lista muestra TODAS las cuentas que
   * pueden entrar al sistema —la oficina, las motos y los comercios—, y
   * llamarla por uno solo de los tres hacía que las otras dos parecieran un
   * error de la pantalla.
   */
  { href: '/admin/drivers', label: 'Usuarios', Icono: Users },
  // Va al lado de Usuarios: una lista es quién puede ENTRAR y la otra a quién
  // se le trabaja. Un comercio aparece en las dos y no es lo mismo: acá está
  // su cuenta, allá su ficha, su dirección y sus horarios.
  { href: '/admin/comercios', label: 'Comercios', Icono: Store },
  { href: '/admin/billing', label: 'Cierre de caja', Icono: Wallet, corto: 'CAJA' },
  // Va pegada al cierre y no con las estadísticas: son la misma plata mirada
  // de cerca y de lejos, y quien cierra un día es el que quiere ver el total.
  { href: '/admin/caja', label: 'Caja y ganancia', Icono: PiggyBank },
  /*
   * La billetera va al lado de las otras dos platas, y contesta lo que ninguna
   * contestaba: cuanto debe cada uno AHORA. El cierre es de un dia y la caja es
   * de un periodo; un saldo no es de un periodo.
   */
  { href: '/admin/billetera', label: 'Billetera', Icono: HandCoins },
  { href: '/admin/resumenes', label: 'Resúmenes', Icono: MessageCircle },
  { href: '/admin/facturacion', label: 'Facturación', Icono: Receipt },
  { href: '/admin/stats', label: 'Estadísticas', Icono: BarChart3 },
  { href: '/admin/stock', label: 'Stock', Icono: Warehouse },
];

/** Iniciales para el redondel del pie. "Oficina Central" → "OC". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return 'OF';
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase();
}

function esActivo(pathname: string, href: string): boolean {
  // /admin es la tabla de envíos, no el padre de todo: si no se compara
  // exacto, queda marcada en las ocho secciones.
  return href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
}

export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { atrasos, enCalle, pedidosDeComercios } = useDatosDelDia();

  const [cajon, setCajon] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [quien, setQuien] = useState<{ nombre: string; email: string }>({
    nombre: 'Oficina',
    email: 'admin',
  });

  useEffect(() => {
    let vivo = true;
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user || !vivo) return;
      const { data: perfil } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle();
      if (vivo) setQuien({ nombre: perfil?.full_name || 'Oficina', email: user.email ?? 'admin' });
    });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Navegar a la sección en la que ya estás no la vuelve a montar, así que
   * mandarle el dato por la dirección no haría nada. Estando ahí se le avisa
   * directo; desde afuera, la dirección alcanza.
   */
  function mandarA(seccion: string, evento: string, dato: string, url: string) {
    if (pathname === seccion) {
      window.dispatchEvent(new CustomEvent(evento, { detail: dato }));
      return;
    }

    router.push(url);

    /*
     * Y además se avisa, por las dudas.
     *
     * La pantalla de destino lee la dirección al montarse, pero eso depende de
     * que Next la monte de nuevo y no la traiga de su caché. Si la trajo de la
     * caché, el aviso lo agarra el que ya estaba escuchando. Y si la montó de
     * nuevo, el aviso llega a una pantalla que ya se abrió sola: abrir dos
     * veces el mismo cuadro es abrirlo una.
     *
     * El respiro es para que la pantalla nueva alcance a ponerse a escuchar.
     */
    setTimeout(() => window.dispatchEvent(new CustomEvent(evento, { detail: dato })), 250);
  }

  /**
   * El buscador de arriba contesta "¿dónde está mi paquete?", que es la
   * pregunta que entra por WhatsApp, y por eso termina en el buscador del
   * Panel del día y no en la tabla: lo que hace falta ahí no es encontrar la
   * fila, es tener la respuesta escrita para mandársela al comercio. La tabla
   * tiene su propio buscador para lo otro.
   */
  function buscar(e: React.FormEvent) {
    e.preventDefault();
    const q = busqueda.trim();
    if (!q) return;
    mandarA('/admin/panel', 'edr-paquete', q, `/admin/panel?paquete=${encodeURIComponent(q)}`);
  }

  async function salir() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  /*
   * "viernes 14/08". El marco se dibuja también en el servidor —que corre en
   * UTC— así que la fecha se calcula en hora de Argentina y con un formato que
   * no cambia según el navegador. Ver `lib/format`.
   */
  const hoy = diaDeHoyAR();

  const navegacion = (
    <>
      <div className="flex flex-col gap-[3px]">
        {ITEMS.map(({ href, label, Icono }) => {
          const activo = esActivo(pathname, href);
          /*
           * Dos globitos distintos en la misma barra: los atrasos del día en
           * el Panel, y los pedidos de los comercios en Comercios. Es el único
           * lugar donde él ve un pedido sin ir a buscarlo.
           */
          const badge =
            href === '/admin/panel'
              ? atrasos.length
              : href === '/admin/comercios'
                ? pedidosDeComercios
                : 0;
          return (
            <Link
              key={href}
              href={href}
              /*
                `replace` y no `push`: la sección nueva PISA el paso que el
                cajón agregó al historial al abrirse. Sin esto queda un paso
                muerto —el del cajón, con la dirección de la pantalla anterior—
                y desde la sección nueva hay que tocar "atrás" dos veces para
                volver, porque la primera no hace nada visible.

                Con esto el historial queda como si el cajón no existiera:
                cada sección elegida es un paso, y atrás vuelve de a uno.
              */
              replace
              /* Elegir una sección cierra el cajón: si no, queda tapando la
                 pantalla nueva. Y se avisa que el cierre es POR IRSE, o el
                 cajón deshace la navegación al sacar su paso del historial —
                 que es lo que hacía que el menú entero devolviera a la
                 pantalla anterior. */
              onClick={() => {
                cerrandoParaNavegar();
                setCajon(false);
              }}
              className={`flex items-center gap-[11px] rounded-[10px] px-3 py-[11px] text-[14.5px] font-semibold transition ${
                activo
                  ? 'bg-[var(--edr-blue)] text-white'
                  : 'text-[#b7cbff] hover:bg-white/8 hover:text-white'
              }`}
            >
              <Icono size={18} strokeWidth={2} className="shrink-0" />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className="edr-mono rounded-full bg-[var(--edr-rojo)] px-[7px] py-0.5 text-[11px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="mt-auto px-1.5 pt-3.5">
        <div className="flex items-center gap-2.5 border-t border-white/12 pt-3.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--edr-yellow)] font-anton text-[13px] text-[var(--edr-blue)]">
            {iniciales(quien.nombre)}
          </div>
          <Link
            href="/admin/profile"
            replace
            onClick={() => {
              cerrandoParaNavegar();
              setCajon(false);
            }}
            className="min-w-0 flex-1"
          >
            <div className="truncate text-[13.5px] font-semibold text-white">{quien.nombre}</div>
            <div className="truncate text-[11.5px] text-[#7f9de8]">{quien.email}</div>
          </Link>
          <button
            onClick={salir}
            title="Salir de la cuenta"
            aria-label="Salir de la cuenta"
            className="p-2 text-[#7f9de8] hover:text-white"
          >
            <LogOut size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-dvh bg-[var(--edr-dark)]">
      {/* ---------- Columna de secciones (de 1024px para arriba) ---------- */}
      <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col gap-[22px] bg-[var(--edr-dark)] px-3.5 py-5 lg:flex">
        <Link href="/admin/panel" className="flex items-center gap-2.5 px-1.5">
          <Logo size={34} />
          <span className="font-anton text-base uppercase leading-[.9] tracking-[-.01em] text-white">
            Envíos
            <br />
            <span className="text-[var(--edr-yellow)]">DosRuedas</span>
          </span>
        </Link>
        {navegacion}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ---------- Barra de arriba ---------- */}
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 bg-[var(--edr-blue)] px-3 py-3 sm:gap-4 sm:px-6">
          <button
            onClick={() => setCajon(true)}
            aria-label="Ver las secciones"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white lg:hidden"
          >
            <Menu size={22} strokeWidth={2} />
          </button>

          <form
            onSubmit={buscar}
            className="order-last flex w-full max-w-[520px] flex-1 items-center gap-2.5 rounded-full bg-[var(--edr-blue-soft)] px-4 py-2.5 sm:order-none sm:px-[18px]"
          >
            <Search size={18} strokeWidth={2.5} className="shrink-0 text-[var(--edr-blue)]" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Código, teléfono, dirección o comercio"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[var(--edr-blue-dark)] outline-none placeholder:text-[#7288ad]"
            />
            <span className="hidden shrink-0 font-bebas text-[12.5px] tracking-[.06em] text-[var(--edr-text-link)] lg:block">
              DÓNDE ESTÁ MI PAQUETE
            </span>
          </form>

          <span className="hidden items-center gap-2 text-[13.5px] font-semibold capitalize text-[var(--edr-blue-soft)] xl:flex">
            <Calendar size={16} strokeWidth={2} className="text-[var(--edr-yellow)]" />
            {hoy}
          </span>

          <span className="hidden items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-[13px] font-semibold text-[var(--edr-blue-soft)] md:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            {enCalle} en la calle
          </span>

          <button
            onClick={() => window.location.reload()}
            aria-label="Actualizar"
            title="Actualizar"
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white sm:flex"
          >
            <RefreshCw size={18} strokeWidth={2} />
          </button>

          <button
            onClick={() => mandarA('/admin', 'edr-nuevo-envio', '', '/admin?nuevo=1')}
            className="ml-auto flex shrink-0 items-center gap-2 rounded-full bg-[var(--edr-yellow)] px-4 py-3 font-bebas text-[17px] tracking-[.06em] text-[var(--edr-blue)] shadow-[var(--edr-sombra)] transition active:scale-95 sm:px-5"
          >
            <Plus size={18} strokeWidth={3} />
            <span className="hidden sm:inline">NUEVO ENVÍO</span>
          </button>
        </header>

        {/* `edr-oficina` es lo que hace que todo lo de adentro sea claro: ahí
            cambian de significado los colores. Ver app/globals.css. */}
        {/* El lugar que deja abajo para la barra fija está en `.edr-oficina`
            (ver globals.css): tiene que contar la franja del gesto de inicio,
            y eso con una clase de medida fija no se puede. */}
        <main className="edr-oficina min-w-0 flex-1">{children}</main>
      </div>

      {cajon && <Cajon cerrar={() => setCajon(false)}>{navegacion}</Cajon>}

      {/* ---------- Barra de abajo del celular ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/12 bg-[var(--edr-blue)] px-2 pb-[env(safe-area-inset-bottom)] lg:hidden">
        {ITEMS.filter((i) => i.corto).map(({ href, corto, Icono }) => {
          const activo = esActivo(pathname, href);
          /*
           * Dos globitos distintos en la misma barra: los atrasos del día en
           * el Panel, y los pedidos de los comercios en Comercios. Es el único
           * lugar donde él ve un pedido sin ir a buscarlo.
           */
          const badge =
            href === '/admin/panel'
              ? atrasos.length
              : href === '/admin/comercios'
                ? pedidosDeComercios
                : 0;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex flex-1 flex-col items-center gap-[3px] py-2.5 ${
                activo ? 'text-[var(--edr-yellow)]' : 'text-[#7f9de8]'
              }`}
            >
              <Icono size={22} strokeWidth={2} />
              <span className="font-bebas text-xs tracking-[.06em]">{corto}</span>
              {badge > 0 && (
                <span className="edr-mono absolute right-[22%] top-1.5 rounded-full bg-[var(--edr-rojo)] px-1.5 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
        <button
          onClick={() => setCajon(true)}
          className="flex flex-1 flex-col items-center gap-[3px] py-2.5 text-[#7f9de8]"
        >
          <Menu size={22} strokeWidth={2} />
          <span className="font-bebas text-xs tracking-[.06em]">MÁS</span>
        </button>
      </nav>
    </div>
  );
}

/** El cajón de secciones del celular. */
function Cajon({ cerrar, children }: { cerrar: () => void; children: ReactNode }) {
  // El atrás del celular lo cierra, en vez de sacar al admin de la pantalla.
  useCerrarConAtras(cerrar);

  return (
    <div className="fixed inset-0 z-50 flex lg:hidden">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={cerrar}
        role="presentation"
        aria-hidden
      />
      <aside className="relative flex h-full w-[268px] flex-col gap-[22px] overflow-y-auto bg-[var(--edr-dark)] px-3.5 py-5">
        <div className="flex items-center gap-2.5 px-1.5">
          <Logo size={34} />
          <span className="flex-1 font-anton text-base uppercase leading-[.9] tracking-[-.01em] text-white">
            Envíos
            <br />
            <span className="text-[var(--edr-yellow)]">DosRuedas</span>
          </span>
          <button
            onClick={cerrar}
            aria-label="Cerrar"
            className="p-2 text-[#7f9de8] hover:text-white"
          >
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
