import './globals.css';
import type { Metadata } from 'next';
import { Outfit } from 'next/font/google';

/** La misma tipografía que usa www.enviosdosruedas.com */
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
});

export const metadata: Metadata = {
  title: 'Envíos DosRuedas',
  description: 'Gestión de envíos de última milla en Mar del Plata',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={outfit.variable}>
      <body>{children}</body>
    </html>
  );
}
