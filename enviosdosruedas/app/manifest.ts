import type { MetadataRoute } from 'next';

/**
 * Hace instalable la app en el celular ("Agregar a pantalla de inicio").
 * Arranca directo en /driver: el repartidor no tiene por qué ver el panel.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Envíos DosRuedas — Repartidor',
    short_name: 'DosRuedas',
    description: 'Hoja de ruta, escaneo de paquetes y cierre de entregas',
    start_url: '/driver',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#eff1ee',
    theme_color: '#0636a5',
    icons: [
      {
        src: '/icon.png',
        sizes: '256x256',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
