import Image from 'next/image';

/**
 * Isotipo de la marca, bajado de www.enviosdosruedas.com (`/public/logo-simple.webp`).
 * El logo completo está en `/public/logo-completo.webp` por si hace falta en
 * algo más grande, como la pantalla de login.
 */
export default function Logo({
  size = 36,
  full = false,
  className = '',
}: {
  size?: number;
  full?: boolean;
  className?: string;
}) {
  return (
    <Image
      src={full ? '/logo-completo.webp' : '/logo-simple.webp'}
      alt="Envíos DosRuedas"
      width={size}
      height={size}
      priority
      className={className}
    />
  );
}
