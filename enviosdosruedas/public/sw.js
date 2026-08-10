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
const CACHE = 'dosruedas-repartidor-v1';

const SHELL = ['/driver', '/driver/dashboard'];

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

  // Navegación: primero la red, y si no hay señal lo último que guardamos.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/driver/dashboard'))),
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
