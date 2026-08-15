/* eslint-disable */
/**
 * Service worker de la app del repartidor.
 *
 * Vive en /public para que el navegador lo sirva desde la raíz del dominio: es
 * la única forma de que su alcance ("scope") sea todo el sitio sin depender de
 * cabeceras especiales del servidor.
 *
 * Lo que hace:
 *  - Guarda el armazón de /driver para que la app abra sin señal.
 *  - NUNCA se mete con las llamadas a Supabase: los datos los maneja la cola
 *    de IndexedDB, y una respuesta cacheada de la API sería peor que un error.
 */
// v7: el atras del celular cierra el cuadro en vez de salir de la app.
// v6: arreglo del lector de QR, que quedaba abierto al volver a la hoja de ruta.
// v5: el rediseño cambió el armazón entero —cabecera, barra de abajo, tipografías—
// y además apareció /driver/caja. Sin subir el número, un celular sin señal
// abriría la app vieja, con nombres de archivo que ya no existen en el servidor.
//
// Subir este número es OBLIGATORIO cada vez que cambie el armazón: `activate`
// borra el caché anterior y vuelve a guardar el nuevo.
const CACHE = 'dosruedas-repartidor-v8';

const SHELL = ['/driver', '/driver/dashboard', '/driver/caja'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Si alguna ruta falla no queremos que se caiga toda la instalación.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Supabase (API, auth y storage) y cualquier otro dominio: derecho a la red.
  if (url.origin !== self.location.origin) return;

  // Navegación: se le da 2,5 segundos a la red y si no contesta se sirve lo
  // guardado. Con una antena saturada, esperar a la red dejaba la pantalla en
  // blanco varios segundos aunque el armazón ya estuviera en el celular.
  if (request.mode === 'navigate') {
    event.respondWith(
      new Promise((resolve) => {
        let resuelto = false;
        const listo = (r) => {
          if (!resuelto && r) {
            resuelto = true;
            resolve(r);
          }
        };

        const desdeCache = () =>
          caches
            .match(request)
            .then((hit) => hit || caches.match('/driver/dashboard'))
            .then(listo);

        const reloj = setTimeout(desdeCache, 2500);

        fetch(request)
          .then((response) => {
            clearTimeout(reloj);
            // Siempre se guarda la versión fresca para la próxima vez.
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            listo(response);
          })
          .catch(() => {
            clearTimeout(reloj);
            desdeCache().then(() => {
              // Ni red ni caché: que el navegador muestre su propio error.
              if (!resuelto) resolve(Response.error());
            });
          });
      }),
    );
    return;
  }

  // Código y estáticos de Next: llevan hash en el nombre, así que el caché nunca miente.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icon')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});


/* ==========================================================================
   NOTIFICACIONES
   El servidor manda un JSON con {title, body, url}. Esto corre aunque la app
   esté cerrada: es el service worker, no la página.
   ========================================================================== */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Envíos DosRuedas', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Envíos DosRuedas';
  const options = {
    body: data.body || '',
    icon: '/icon.png',
    badge: '/icon.png',
    vibrate: [120, 60, 120],
    // `tag` evita que se apilen diez avisos iguales: el nuevo pisa al anterior.
    tag: data.tag || 'edr',
    renotify: true,
    data: { url: data.url || '/driver/dashboard' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/driver/dashboard';

  // Si la app ya está abierta, la trae al frente en vez de abrir otra pestaña.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const cliente of lista) {
        if (cliente.url.includes('/driver') && 'focus' in cliente) {
          cliente.navigate(destino);
          return cliente.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
