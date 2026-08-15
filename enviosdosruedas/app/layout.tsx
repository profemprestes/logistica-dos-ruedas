import './globals.css';
import type { Metadata } from 'next';
import { Anton, Bebas_Neue, Outfit } from 'next/font/google';

/** La misma tipografía que usa www.enviosdosruedas.com */
const outfit = Outfit({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-outfit',
});

/**
 * Anton: titulares y direcciones. Siempre en mayúscula, nunca para cifras
 * —sus números son angostos y desparejos, y acá los números son plata—.
 */
const anton = Anton({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-anton',
});

/** Bebas Neue: botones, chips, rótulos y encabezados de tabla. */
const bebas = Bebas_Neue({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-bebas',
});

export const metadata: Metadata = {
  title: 'Envíos DosRuedas',
  description: 'Gestión de envíos de última milla en Mar del Plata',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${outfit.variable} ${anton.variable} ${bebas.variable}`}>
      <body>{children}</body>
    </html>
  );
}
