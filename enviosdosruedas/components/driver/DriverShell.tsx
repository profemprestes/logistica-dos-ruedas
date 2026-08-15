'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ListChecks, Map as MapIcon, ScanLine, User, Wallet, Wifi, WifiOff } from 'lucide-react';
import PermissionGate from '@/components/driver/PermissionGate';
import RoleGate from '@/components/driver/RoleGate';
import { ToastProvider, useToast } from '@/components/driver/Toast';
import { supabase } from '@/lib/supabaseClient';
import { useOnline } from '@/lib/driver/useOnline';
import { watchConnection } from '@/lib/driver/sync';
import { escucharAvisosNativos } from '@/lib/driver/pushNativo';

/**
 * Envoltorio de toda la app del repartidor.
 *
 * Además de lo de siempre —permisos, service worker, reintento de la cola— ahora
 * pone la cabecera de marca y la barra de abajo, que son iguales en todas las
 * pantallas. Antes cada pantalla dibujaba su propio encabezado y sus propios
 * accesos, así que agregar una sección era acordarse de tocar cinco archivos.
 *
 * LA BARRA VA FIJA ABAJO porque la app se usa con una mano y en movimiento: el
 * pulgar llega al borde inferior sin cambiar el agarre. Arriba sólo queda lo
 * que se lee, no lo que se toca.
 */

/* ------------------------------------------------------------------ escáner */

/**
 * El escáner lo abre la barra, pero lo dibuja la hoja de ruta.
 *
 * El botón vive acá y el lector vive allá porque lo que se hace con el código
 * escaneado —buscar el envío y asignárselo— es asunto de la hoja de ruta. En
 * vez de mudar esa lógica al shell, el shell sólo dice "abrilo" y la pantalla
 * decide qué hacer.
 */
const EscanerCtx = createContext<{ abierto: boolean; abrir: () => void; cerrar: () => void }>({
  abierto: false,
  abrir: () => {},
  cerrar: () => {},
});

export const useEscaner = () => useContext(EscanerCtx);

export default function DriverShell({ children }: { children: ReactNode }) {
  const [escaner, setEscaner] = useState(false);

  /*
   * Las dos funciones se memorizan y el valor del contexto también.
   *
   * No es prolijidad: la hoja de ruta apaga el lector cuando se va de pantalla,
   * y para eso el `cerrar` que recibe tiene que ser SIEMPRE EL MISMO. Si
   * cambiara en cada dibujo, ese apagado correría todo el tiempo y el lector se
   * cerraría solo apenas se abre.
   */
  const abrir = useCallback(() => setEscaner(true), []);
  const cerrar = useCallback(() => setEscaner(false), []);
  const escanerCtx = useMemo(
    () => ({ abierto: escaner, abrir, cerrar }),
    [escaner, abrir, cerrar],
  );

  return (
    <ToastProvider>
      {/* El rol se mira ANTES que los permisos: al admin no hay por qué
          pedirle cámara y GPS para después echarlo de esta app. */}
      <RoleGate>
        <PermissionGate>
          <EscanerCtx.Provider value={escanerCtx}>
            {/* Alto fijo y el medio con scroll propio: así la cabecera y la
                barra no se van de la pantalla al deslizar la lista. */}
            <div className="edr-driver flex h-dvh flex-col overflow-hidden bg-[var(--edr-dark)]">
              <Background />
              <Cabecera />
              <AvisoSinSenal />
              <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
              <BarraInferior />
            </div>
          </EscanerCtx.Provider>
        </PermissionGate>
      </RoleGate>
    </ToastProvider>
  );
}

/** No dibuja nada: sólo mantiene vivos el service worker y la sincronización. */
function Background() {
  const toast = useToast();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Sin service worker la app sigue andando: pierde el arranque sin señal, nada más.
    });
  }, []);

  // Adentro de la app de Android, quién dibuja el aviso cuando llega uno. En un
  // navegador no hace nada: ahí lo hace el service worker de arriba.
  useEffect(() => {
    void escucharAvisosNativos();
  }, []);

  useEffect(() => {
    return watchConnection(({ sent, serverFailures, blocked, lastServerError }) => {
      if (sent > 0) toast(`Se enviaron ${sent} entrega(s) que estaban guardadas.`, 'ok');
      // Un fallo de red se reintenta solo y no vale la pena avisarlo; uno del
      // servidor sí, porque va a seguir fallando hasta que alguien lo mire.
      if (serverFailures > 0)
        toast(`El servidor rechazó ${serverFailures}: ${lastServerError}`, 'error');
      if (blocked > 0)
        toast(`${blocked} entrega(s) no se van a poder enviar. Miralas en la hoja de ruta.`, 'error');
    });
  }, [toast]);

  return null;
}

/* ---------------------------------------------------------------- cabecera */

/** Las iniciales del nombre: "Emiliano Garri" → "EG". */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '··';
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase();
}

function Cabecera() {
  const online = useOnline();
  const [nombre, setNombre] = useState('');

  useEffect(() => {
    let vivo = true;

    supabase.auth.getUser().then(({ data }) => {
      const id = data.user?.id;
      if (!id) return;
      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', id)
        .maybeSingle()
        .then(({ data: perfil }) => {
          if (vivo && perfil?.full_name) setNombre(String(perfil.full_name));
        });
    });

    return () => {
      vivo = false;
    };
  }, []);

  return (
    <header className="flex shrink-0 items-center gap-2.5 border-b border-white/10 bg-[var(--edr-dark)] px-4 pb-3 pt-3.5">
      <Image
        src="/logo-simple.webp"
        alt=""
        width={30}
        height={30}
        className="h-[30px] w-[30px] shrink-0"
        priority
      />

      {/* El wordmark es texto, no imagen: escala solo y pesa cero. */}
      <div className="flex-1 font-anton text-[15px] uppercase leading-[.9] tracking-[-.01em] text-white">
        Envíos
        <br />
        <span className="text-[var(--edr-yellow)]">DosRuedas</span>
      </div>

      <span
        className={`flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-2 font-bebas text-sm tracking-[.06em] ${
          online ? 'bg-white/10 text-white' : 'bg-[var(--edr-yellow)] text-[var(--edr-blue-dark)]'
        }`}
      >
        {online ? <Wifi size={15} strokeWidth={2} /> : <WifiOff size={15} strokeWidth={2} />}
        {online ? 'CON SEÑAL' : 'SIN SEÑAL'}
      </span>

      <Link
        href="/driver/profile"
        aria-label="Mi perfil"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-[var(--edr-blue)] font-anton text-[15px] text-[var(--edr-yellow)]"
      >
        {nombre ? iniciales(nombre) : <User size={18} strokeWidth={2} />}
      </Link>
    </header>
  );
}

function AvisoSinSenal() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 bg-[var(--edr-yellow)] px-4 py-2.5 font-bebas text-base tracking-[.05em] text-[var(--edr-blue-dark)]">
      <WifiOff size={16} strokeWidth={2} className="shrink-0" />
      SIN SEÑAL · SE GUARDA TODO EN EL CELULAR
    </div>
  );
}

/* ----------------------------------------------------------- barra de abajo */

const SECCIONES = [
  { href: '/driver/dashboard', label: 'RUTA', Icono: ListChecks },
  { href: '/driver/mapa', label: 'MAPA', Icono: MapIcon },
  // El escáner va en el medio, no acá: es un botón y no una sección.
  { href: '/driver/caja', label: 'CAJA', Icono: Wallet },
  { href: '/driver/profile', label: 'PERFIL', Icono: User },
] as const;

function BarraInferior() {
  const pathname = usePathname();
  const router = useRouter();
  const { abrir } = useEscaner();

  const item = (
    { href, label, Icono }: (typeof SECCIONES)[number],
    activo: boolean,
  ) => (
    <Link
      key={href}
      href={href}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 transition active:scale-95 ${
        activo ? 'text-[var(--edr-yellow)]' : 'text-[var(--edr-muted)]'
      }`}
    >
      <Icono size={24} strokeWidth={2} />
      <span className="font-bebas text-[13px] tracking-[.06em]">{label}</span>
    </Link>
  );

  return (
    <nav className="flex shrink-0 items-end justify-between gap-1 border-t border-white/10 bg-[var(--edr-blue)] px-3 pb-[max(1.125rem,env(safe-area-inset-bottom))] pt-2.5">
      {SECCIONES.slice(0, 2).map((s) => item(s, pathname === s.href))}

      {/*
       * El botón de escanear.
       *
       * Sobresale de la barra a propósito: es la acción que más se toca en la
       * calle —cada paquete que sube a la moto pasa por acá— y encontrarlo sin
       * mirar, por el relieve, es justo lo que hace falta con la moto en
       * marcha. El borde grueso del color del fondo es lo que lo despega.
       */}
      <button
        onClick={() => {
          // Si está en otra pantalla, primero vuelve a la ruta: el lector vive
          // ahí porque ahí está la lógica de qué hacer con el código.
          if (pathname !== '/driver/dashboard') router.push('/driver/dashboard');
          abrir();
        }}
        aria-label="Escanear paquete"
        className="-mt-[26px] flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-px rounded-full border-4 border-[var(--edr-dark)] bg-[var(--edr-yellow)] text-[var(--edr-blue)] shadow-[0_6px_18px_rgba(255,236,1,.3)] transition active:scale-95"
      >
        <ScanLine size={28} strokeWidth={2.5} />
        <span className="font-bebas text-[11px] tracking-[.06em]">ESCANEAR</span>
      </button>

      {SECCIONES.slice(2).map((s) => item(s, pathname === s.href))}
    </nav>
  );
}
