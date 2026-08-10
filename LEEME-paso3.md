# Paso 3 — App del repartidor (PWA)

## 1. Librerías nuevas

Ya quedaron instaladas, pero si armás el proyecto en otra máquina:

```bash
npm install html5-qrcode idb
```

## 2. Base de datos (¡esto va primero!)

Abrí Supabase → **SQL Editor** → pegá todo el contenido de
`enviosdosruedas/sql/paso3-repartidor.sql` → **Run**.

Eso crea:

- Columnas `delivered_at` y `failure_reason` en `shipments`.
- Tabla `delivery_events`: un renglón por cada intento de entrega, con foto, GPS,
  quién recibió y el motivo si no se pudo.
- `scan_and_assign(p_code)`: asigna el paquete al repartidor que escanea y lo pasa
  a "En camino".
- `resolve_delivery(...)`: cierra el envío y guarda el comprobante, todo junto.
- El bucket privado `comprobantes` para las fotos.

> **Si el paso 1 ya te había creado un `scan_and_assign`**, no hay choque: el viejo
> recibe un número y este recibe texto, así que conviven. Si preferís limpiar,
> corré `drop function if exists public.scan_and_assign(bigint);`.

**Por qué `resolve_delivery` recibe un `client_event_id`:** el celular arma ese
UUID *antes* de tener señal. Si la cola reintenta la misma entrega dos veces, la
segunda no duplica nada. Es lo que hace que "guardar sin conexión" sea seguro.

## 3. Perfiles de repartidor

Cada repartidor necesita su fila en `profiles` con `role = 'repartidor'` y
`active = true`. Al entrar por `/login`, la app lo manda solo a `/driver`
(a los demás los sigue mandando a `/admin`).

## 4. Probarlo

La cámara y el GPS **sólo funcionan en HTTPS** (o en `localhost`). Para probar
desde el celular con el server de tu compu:

```bash
npx next dev --experimental-https
```

Y entrás desde el celular a `https://<ip-de-tu-compu>:3000/driver`.

En el celular: menú de Chrome → **Agregar a pantalla de inicio**. Queda como una
app, sin barra de direcciones.

## 5. Cómo se usa en la calle

1. **Entra a `/driver`** → pide cámara y GPS. Si los rechaza, pantalla roja y no
   puede hacer nada más hasta habilitarlos.
2. **ESCANEAR PAQUETE** (el botón negro gigante de abajo) → lee el QR de la
   etiqueta → el envío se le asigna, pasa a "En camino" y aparece en su hoja de ruta.
   Si el QR está roto, hay un campo para tipear el código a mano.
3. **Toca una tarjeta** → ve el detalle, puede llamar al destinatario o abrir el
   mapa, y tiene dos botones: **Entregado** / **No entregado**.
4. **Entregado** pide nombre, DNI y foto. **No entregado** pide motivo y foto.
   El GPS se toma solo, sin preguntar.
5. Las tarjetas **a cobrar salen en amarillo flúor** con el monto gigante en negro.

## 6. Qué pasa sin señal

- La entrega se guarda **primero** en el celular (IndexedDB) y recién después se
  intenta subir. Si no hay señal aparece: *"Guardado sin conexión. Se enviará al
  recuperar señal"*.
- En el encabezado se ve `N entrega(s) esperando señal`; tocándolo reintenta.
- Reintenta solo cuando vuelve la conexión, cuando el repartidor vuelve a la app
  y, por las dudas, una vez por minuto.
- **Nada se borra del celular hasta que Supabase confirma.** Si algo falla queda
  encolado con el error anotado.
- La hoja de ruta queda cacheada: puede ver direcciones en un sótano.
- **Lo único que necesita internet sí o sí es escanear**, porque la asignación del
  paquete la decide el servidor.

## 7. Detalles que importan

- **La cámara se apaga al cerrar el lector.** El `stop()` está encadenado a la
  promesa de arranque, así que aunque cierre el modal mientras la cámara está
  abriendo, igual se apaga.
- **Las fotos se achican a 1280 px / ~150 KB** antes de guardarse. Sin eso, 30
  entregas sin señal llenan la memoria del celular y después no suben nunca.
- El icono es un SVG (`public/icon.svg`). Anda en Android; si querés que iOS lo
  muestre lindo en la pantalla de inicio, generá los PNG de 192 y 512 px con
  <https://realfavicongenerator.net/> y agregalos en `app/manifest.ts`.
- El service worker está en `public/sw.js` (no en `lib/`) para que su alcance sea
  todo el sitio sin depender de cabeceras del servidor. Cuando lo cambies, subile
  el número a `CACHE` (`dosruedas-repartidor-v1` → `v2`) para que los celulares
  tiren el caché viejo.
