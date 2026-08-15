import type { CapacitorConfig } from '@capacitor/cli';

/**
 * La app de Android del repartidor.
 *
 * NO ES OTRO SISTEMA. Adentro del APK no va una copia del sitio: va una ventana
 * que abre `https://…/driver`, el mismo que se usa desde el navegador. Se sigue
 * desplegando como siempre y la app agarra la versión nueva sola, sin que nadie
 * tenga que reinstalar nada.
 *
 * Lo único que el APK agrega es lo que un navegador no puede hacer: seguir
 * mandando la posición con la app atrás o la pantalla apagada. Ver
 * `lib/driver/nativo.ts`.
 *
 * A QUÉ SITIO APUNTA. Sale de EDR_APP_URL, y por eso el mismo proyecto sirve
 * para la app de prueba y para la de verdad:
 *
 *   - sin la variable, apunta a producción;
 *   - para probar, se le pasa la URL que Vercel arma sola para esta rama, así
 *     se instala en un celular sin que producción se entere.
 *
 * Se define ANTES de `npx cap sync`, que es cuando se escribe en el proyecto de
 * Android. Cambiarla después no hace nada hasta el próximo sync.
 */
const PRODUCCION = 'https://www.logisticadosruedas.com';

const sitio = process.env.EDR_APP_URL ?? PRODUCCION;

const config: CapacitorConfig = {
  appId: 'com.enviosdosruedas.repartidor',
  appName: 'DosRuedas Repartidor',

  /*
   * Carpeta obligatoria aunque no se use: Capacitor pide una y la copia al
   * APK. Como la app abre el sitio de la red, adentro sólo hay un cartel para
   * el caso de que no se pueda llegar.
   */
  webDir: 'android-www',

  server: {
    url: `${sitio}/driver`,
    androidScheme: 'https',
    // Sin esto, tocar un link del propio sitio abriría Chrome encima de la app.
    allowNavigation: [new URL(sitio).host],
  },

  android: {
    /*
     * OBLIGATORIO, y no es un detalle: sin esto el GPS deja de mandar a los
     * cinco minutos de tener la app atrás. O sea, se rompería exactamente en el
     * caso para el que existe la app. Lo pide el plugin de ubicación.
     */
    useLegacyBridge: true,

    /*
     * Deja enchufar el celular a la computadora y ver la consola de la app en
     * `chrome://inspect`, igual que una página cualquiera.
     *
     * Es la única forma de averiguar por qué algo no anda adentro del APK: no
     * hay consola a la que asomarse desde el celular. Va prendido mientras
     * probamos y se apaga para la versión que usan los repartidores.
     */
    webContentsDebuggingEnabled: sitio !== PRODUCCION,
  },
};

export default config;
