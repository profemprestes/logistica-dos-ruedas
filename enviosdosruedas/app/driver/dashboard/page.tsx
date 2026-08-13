'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import QrScannerModal from '@/components/driver/QrScannerModal';
import ResolveDeliveryModal from '@/components/driver/ResolveDeliveryModal';
import ShipmentCard from '@/components/driver/ShipmentCard';
import ShipmentSheet from '@/components/driver/ShipmentSheet';
import Logo from '@/components/Logo';
import { useToast } from '@/components/driver/Toast';
import { seguirEnviando } from '@/lib/driver/posicion';
import {
  cacheRoute,
  dropBlocked,
  listPending,
  readCachedRoute,
  type DeliveryKind,
} from '@/lib/driver/db';
import { errorText } from '@/lib/driver/errors';
import { marcarEstado, type EstadoIntermedio } from '@/lib/driver/status';
import { flushPending } from '@/lib/driver/sync';
import { useOnline } from '@/lib/driver/useOnline';
import { money, shipmentCash, type Shipment } from '@/lib/format';
import { partirRuta } from '@/lib/scheduled';

/**
 * Todo lo que todavía tiene abierto, sin importar cómo llegó a su hoja de ruta.
 *
 * Antes esta lista arrancaba en 'retirado' y dejaba afuera 'creado' y
 * 'pendiente_retiro': los envíos que el admin le asignaba a mano desde el panel
 * nunca le aparecían al chofer, porque todavía no los había escaneado.
 * Los únicos que no van son los cerrados: 'entregado' y 'cancelado'.
 */
const ACTIVE_STATUSES = [
  'creado',
  'pendiente_retiro',
  'retirado',
  'en_camino',
  'pendiente_entrega',
];

function fetchRoute(driverId: string) {
  return supabase
    .from('shipments')
    .select('*')
    .eq('assigned_driver', driverId)
    .in('status', ACTIVE_STATUSES)
    .order('id', { ascending: true });
}

export default function DriverDashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();

  const [driver, setDriver] = useState<{ id: string; name: string } | null>(null);
  const [route, setRoute] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{
    /** Se siguen reintentando solas. */
    sendable: number;
    /** Trabadas: el servidor las rechazó definitivamente. */
    blocked: number;
    blockedCodes: string[];
    lastError: string | null;
  }>({ sendable: 0, blocked: 0, blockedCodes: [], lastError: null });

  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [resolving, setResolving] = useState<DeliveryKind | null>(null);

  // --- sesión ------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace('/login');
        return;
      }

      // El id alcanza para pedir la hoja de ruta. Antes se esperaba también el
      // nombre del perfil, y esa consulta de más retrasaba TODA la pantalla.
      setDriver({ id: user.id, name: '' });

      supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data: profile }) =>
          setDriver((prev) => (prev ? { ...prev, name: profile?.full_name ?? '' } : prev)),
        );
    });
  }, [router]);

  // --- hoja de ruta ------------------------------------------------------
  useEffect(() => {
    if (!driver) return;
    let cancelled = false;
    let fromNetwork = false;

    // Primero lo que ya está en el celular: se ve al instante y funciona sin señal.
    readCachedRoute().then((rows) => {
      if (cancelled || fromNetwork || rows.length === 0) return;
      setRoute(rows);
      setLoading(false);
    });

    fetchRoute(driver.id).then(({ data, error }) => {
      if (cancelled) return;
      fromNetwork = true;
      if (error) {
        setLoading(false); // sin señal nos quedamos con lo cacheado
        return;
      }
      const rows = (data ?? []) as Shipment[];
      setRoute(rows);
      setLoading(false);
      // El caché copia EXACTAMENTE lo que contestó el servidor, incluso si es
      // una lista vacía: si no, los envíos borrados desde el panel seguían
      // apareciendo en el celular para siempre.
      cacheRoute(rows);
    });

    return () => {
      cancelled = true;
    };
  }, [driver]);

  /** Vuelve a pedir la hoja de ruta sin recargar la página. */
  const recargar = useCallback(() => {
    if (!driver) return;
    setLoading(true);
    fetchRoute(driver.id).then(({ data, error }) => {
      setLoading(false);
      if (error) {
        toast('Sin señal: seguís viendo la última hoja de ruta guardada.', 'warn');
        return;
      }
      const rows = (data ?? []) as Shipment[];
      setRoute(rows);
      cacheRoute(rows);
    });
  }, [driver, toast]);

  // --- cola offline ------------------------------------------------------
  const refreshPending = useCallback(() => {
    listPending().then((items) => {
      const blocked = items.filter((i) => i.blocked);
      setPending({
        sendable: items.length - blocked.length,
        blocked: blocked.length,
        blockedCodes: blocked.map((i) => i.trackingCode),
        // El último error anotado: si el servidor está rechazando algo,
        // que se vea acá en vez de decir "esperando señal" para siempre.
        lastError: items.map((i) => i.lastError).filter(Boolean).pop() ?? null,
      });
    });
  }, []);

  /** Tirar una entrega trabada es perder el comprobante: se pregunta primero. */
  const discardBlocked = useCallback(() => {
    const detalle = pending.blockedCodes.join(', ');
    const ok = confirm(
      `Estas ${pending.blocked} entrega(s) no se pueden enviar:\n\n${detalle}\n\n` +
        `${pending.lastError ?? ''}\n\n` +
        'Si las descartás se borran del celular y no quedan registradas. ¿Seguimos?',
    );
    if (!ok) return;
    dropBlocked().then((n) => {
      refreshPending();
      toast(`Se descartaron ${n} entrega(s).`, 'info');
    });
  }, [pending, refreshPending, toast]);

  useEffect(() => {
    refreshPending();
    const timer = window.setInterval(refreshPending, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshPending]);

  /**
   * Mientras haya algo en camino, avisar por dónde va.
   *
   * La hoja de ruta se lee por referencia y no por dependencia a propósito: si
   * el efecto se rearmara con cada cambio de la ruta, mandaría una posición de
   * más cada vez que se toca un envío.
   */
  const rutaRef = useRef(route);
  useEffect(() => {
    rutaRef.current = route;
  }, [route]);

  useEffect(() => {
    return seguirEnviando(() => rutaRef.current.some((s) => s.status === 'en_camino'));
  }, []);

  // --- escaneo -----------------------------------------------------------
  const handleDetected = useCallback(
    async (code: string) => {
      setScanning(false);

      if (!navigator.onLine) {
        toast('Sin señal: para sumar un paquete hace falta internet.', 'error');
        return;
      }

      const { data, error } = await supabase.rpc('scan_and_assign', { p_code: code });

      if (error) {
        console.error('[escaneo] scan_and_assign falló', { code: error.code, message: error.message });
        toast(errorText(error.message), 'error');
        return;
      }

      // Escanear significa que el paquete ya está en la moto: queda "retirado".
      // El paso a "en camino" lo marca él cuando arranca el reparto.
      const escaneado = data as Shipment;
      const { shipment: actualizado } = await marcarEstado(escaneado.id, 'retirado');
      const shipment = actualizado ?? escaneado;

      setRoute((prev) =>
        prev.some((s) => s.id === shipment.id)
          ? prev.map((s) => (s.id === shipment.id ? shipment : s))
          : [shipment, ...prev],
      );
      toast(`Retirado: ${shipment.address_street}`, 'ok');
    },
    [toast],
  );

  /** Marca retirado / en camino y refleja el cambio en la lista al instante. */
  const cambiarEstado = useCallback(
    async (s: Shipment, estado: EstadoIntermedio) => {
      const { shipment, error } = await marcarEstado(s.id, estado);
      if (error || !shipment) {
        toast(error ?? 'No se pudo cambiar el estado.', 'error');
        return;
      }
      setRoute((prev) => prev.map((x) => (x.id === shipment.id ? shipment : x)));
      setSelected((prev) => (prev && prev.id === shipment.id ? shipment : prev));
      toast(estado === 'retirado' ? 'Marcado como retirado.' : 'Marcado en camino.', 'ok');
    },
    [toast],
  );

  // --- cierre de entrega -------------------------------------------------
  function handleResolved(shipmentId: number) {
    setRoute((prev) => prev.filter((s) => s.id !== shipmentId));
    setSelected(null);
    setResolving(null);
    refreshPending();
  }

  const { deHoy, proximos } = partirRuta(route);
  // El total del día no cuenta lo que todavía no se reparte: si lo sumara, el
  // repartidor rendiría de más y el cierre de caja no daría.
  const totalCash = deHoy.reduce((acc, s) => acc + shipmentCash(s).total, 0);

  return (
    <div className="min-h-dvh pb-32">
      {/* ---------- Encabezado ---------- */}
      <header className="bg-[var(--edr-surface-2)] px-4 py-3 text-white">
        <div className="flex items-center justify-between gap-3">
          <Logo size={34} className="shrink-0 rounded bg-[var(--edr-surface)]/95 p-0.5" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-black leading-tight">
              {driver?.name || 'Hoja de ruta'}
            </h1>
            <p className="text-xs text-white/70">
              {deHoy.length} envío(s) hoy
              {proximos.length > 0 && ` · ${proximos.length} para después`} ·{' '}
              {online ? 'con señal' : 'sin señal'}
            </p>
          </div>
          {/* Actualiza los datos SIN recargar la página: una recarga volvería a
              disparar el pedido de permisos de cámara y GPS. */}
          <button
            onClick={() => {
              recargar();
              refreshPending();
            }}
            title="Actualizar"
            aria-label="Actualizar"
            className="shrink-0 rounded-lg bg-white/15 px-3 py-2 text-xl leading-none"
          >
            ⟳
          </button>

          <Link
            href="/driver/mapa"
            className="shrink-0 rounded-lg bg-[var(--edr-surface)]/15 px-3 py-2 text-sm font-bold"
          >
            🗺️ Mapa
          </Link>

          <Link
            href="/driver/profile"
            className="shrink-0 rounded-lg bg-[var(--edr-surface)]/15 px-3 py-2 text-sm font-bold"
          >
            👤 Mi perfil
          </Link>
        </div>

        {totalCash > 0 && (
          <div className="mt-2 rounded-lg bg-[var(--edr-fluo)] text-black px-3 py-2 text-center text-black">
            <span className="text-sm font-black uppercase tracking-wide">A cobrar hoy: </span>
            <span className="edr-mono text-lg font-black">{money(totalCash)}</span>
          </div>
        )}

        {/* En camino: se reintentan solas, sólo hay que esperar. */}
        {pending.sendable > 0 && (
          <button
            onClick={() =>
              flushPending().then((outcome) => {
                refreshPending();
                if (outcome.sent > 0) toast(`Se enviaron ${outcome.sent} entrega(s).`, 'ok');
                else if (outcome.blocked > 0)
                  toast(outcome.lastServerError ?? 'Quedaron trabadas.', 'error');
                else if (outcome.serverFailures > 0)
                  toast(`El servidor las rechaza: ${outcome.lastServerError}`, 'error');
                else if (outcome.networkFailures > 0)
                  toast('Todavía no hay señal para enviarlas.', 'warn');
              })
            }
            className="mt-2 w-full rounded-lg bg-amber-400 px-3 py-2 text-center text-sm font-black text-black"
          >
            {pending.sendable} entrega(s) sin enviar · tocá para reintentar
            {pending.lastError && (
              <span className="mt-1 block text-xs font-semibold opacity-90">
                {pending.lastError}
              </span>
            )}
          </button>
        )}

        {/* Trabadas: reintentar no sirve, hay que decidir qué hacer con ellas. */}
        {pending.blocked > 0 && (
          <button
            onClick={discardBlocked}
            className="mt-2 w-full rounded-lg bg-red-600 px-3 py-2 text-center text-sm font-black text-white"
          >
            {pending.blocked} entrega(s) no se pueden enviar · tocá para descartar
            <span className="mt-1 block text-xs font-semibold opacity-90">
              {pending.lastError}
            </span>
          </button>
        )}
      </header>

      {/* ---------- Hoja de ruta ---------- */}
      <main className="space-y-3 px-3 py-3">
        {loading && (
          <p className="py-10 text-center text-base font-semibold text-[var(--edr-muted)]">
            Cargando tu hoja de ruta…
          </p>
        )}

        {!loading && route.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-6 py-12 text-center">
            <p className="text-xl font-black">No tenés paquetes todavía</p>
            <p className="mt-1 text-base text-[var(--edr-muted)]">
              Escaneá el QR de cada etiqueta al cargar la moto.
            </p>
          </div>
        )}

        {!loading && deHoy.length === 0 && proximos.length > 0 && (
          <div className="rounded-2xl border-2 border-dashed border-[var(--edr-border)] px-6 py-8 text-center">
            <p className="text-xl font-black">Por hoy no te queda nada</p>
            <p className="mt-1 text-base text-[var(--edr-muted)]">
              Abajo están los que ya te cargaron para los próximos días.
            </p>
          </div>
        )}

        {deHoy.map((s) => (
          <ShipmentCard key={s.id} shipment={s} onOpen={setSelected} onEstado={cambiarEstado} />
        ))}

        {/* Programados: se ven para poder organizarse, pero no se tocan hasta
            el día. El candado real está en la base (paso 14). */}
        {proximos.length > 0 && (
          <>
            <h2 className="px-1 pt-4 text-sm font-black uppercase tracking-widest text-[var(--edr-muted)]">
              Próximos días · {proximos.length}
            </h2>
            {proximos.map((s) => (
              <ShipmentCard key={s.id} shipment={s} onOpen={setSelected} onEstado={cambiarEstado} />
            ))}
          </>
        )}
      </main>

      {/* ---------- Botón gigante ---------- */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => setScanning(true)}
          className="w-full rounded-2xl bg-[var(--edr-yellow)] px-6 py-7 text-3xl font-black text-black active:scale-[0.99]"
        >
          📷 ESCANEAR PAQUETE
        </button>
      </div>

      {/* ---------- Capas ---------- */}
      {scanning && (
        <QrScannerModal onDetected={handleDetected} onClose={() => setScanning(false)} />
      )}

      {selected && !resolving && (
        <ShipmentSheet
          shipment={selected}
          onClose={() => setSelected(null)}
          onResolve={setResolving}
          onEstado={cambiarEstado}
        />
      )}

      {selected && resolving && (
        <ResolveDeliveryModal
          shipment={selected}
          kind={resolving}
          onClose={() => setResolving(null)}
          onResolved={handleResolved}
          onSynced={refreshPending}
        />
      )}
    </div>
  );
}
