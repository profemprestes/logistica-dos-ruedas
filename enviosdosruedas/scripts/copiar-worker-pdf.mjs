/**
 * Deja el worker de pdf.js donde el navegador lo pueda pedir.
 *
 * Leer un PDF pasa en el navegador, y pdf.js hace ese trabajo en un hilo
 * aparte: un archivo suelto que hay que servir. Los bundlers lo empaquetan cada
 * uno a su manera y esa es justo la parte que se rompe en cada actualización
 * de Next, así que acá se hace lo aburrido: se copia a `public/` y se lo pide
 * por su ruta.
 *
 * Corre solo antes de `dev` y de `build` —también en Vercel—, así que la copia
 * siempre es la de la versión instalada. Por eso el archivo NO se guarda en el
 * repositorio: si quedara commiteado, una actualización de pdfjs-dist dejaría
 * un worker viejo leyendo los PDF, que es de los errores que no se ven hasta
 * que un envío sale mal.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const origen = join(dirname(require.resolve('pdfjs-dist/package.json')), 'legacy/build/pdf.worker.min.mjs');
const destino = join(process.cwd(), 'public', 'pdf.worker.min.mjs');

mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origen, destino);
console.log('worker de pdf.js copiado a public/pdf.worker.min.mjs');
