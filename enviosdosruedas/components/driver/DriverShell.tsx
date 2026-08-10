'use client';

import { useEffect, type ReactNode } from 'react';
import PermissionGate from '@/components/driver/PermissionGate';
import { ToastProvider, useToast } from '@/components/driver/Toast';
import { useOnline } from '@/lib/driver/useOnline';
import { watchConnection } from '@/lib/driver/sync';

/**
 * Envoltorio de toda la app del repartidor: avisos, portón de permisos,
 * service worker y reintento de la cola cuando vuelve la señal.
 */
export default function DriverShell({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <PermissionGate>
        <div className="edr-driver">
          <Background />
          <OfflineBanner />
          {children}
        </div>
      </PermissionGate>
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

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div className="sticky top-0 z-30 bg-amber-400 px-4 py-2 text-center text-sm font-black text-black">
      SIN CONEXIÓN — seguí trabajando, se guarda todo en el celular
    </div>
  );
}
