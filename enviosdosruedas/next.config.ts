import type { NextConfig } from 'next';

/**
 * Cabeceras de seguridad, en todas las páginas.
 *
 * Son instrucciones para el navegador del que entra. No cambian nada de lo que
 * se ve; le dicen qué NO permitir.
 */
const CABECERAS = [
  /*
   * Que el código del envío no se filtre a terceros.
   *
   * Ésta es la que más importaba. El mapa del seguimiento le pide las baldosas
   * a OpenStreetMap, y en cada pedido el navegador manda de regalo la
   * dirección de la página donde está — o sea el link completo, con el código
   * del envío adentro. Con esto sale sólo el dominio, sin el código.
   */
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /*
   * Que nadie meta el panel dentro de una página ajena.
   *
   * El ataque es viejo y simple: alguien arma una web con el panel escondido y
   * transparente encima de un botón cualquiera, y los clics van a parar al
   * panel sin que se vea. SAMEORIGIN y no DENY para no romper una vista previa
   * propia el día de mañana.
   */
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },

  /*
   * Que el navegador no adivine el tipo de archivo. Sin esto, una foto subida
   * a mano podría llegar a ejecutarse como si fuera un script.
   */
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];

/*
 * DOS QUE NO ESTÁN, A PROPÓSITO.
 *
 * `Content-Security-Policy` es la más fuerte de todas, y también la que rompe
 * pantallas si se pone de memoria: habría que enumerar lo que hoy usan Next,
 * el mapa y las fotos firmadas, y cualquier olvido se ve recién en producción
 * y como una pantalla en blanco. Merece su propio rato, con la app abierta al
 * lado para ir probando.
 *
 * `Permissions-Policy` apagaría cámara y GPS para todos, y son justamente las
 * dos cosas que la app del repartidor necesita. Mal escrita, deja a los
 * repartidores sin poder sacar la foto de entrega. No vale la pena por ahora.
 */

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: CABECERAS }];
  },
};

export default nextConfig;
