import type { Metadata, Viewport } from 'next';
import DriverShell from '@/components/driver/DriverShell';

export const metadata: Metadata = {
  title: 'DosRuedas — Repartidor',
  description: 'Hoja de ruta y cierre de entregas',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Sin zoom: manejando, un doble toque sin querer no tiene que descuadrar la pantalla.
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0636a5',
};

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <DriverShell>{children}</DriverShell>;
}
