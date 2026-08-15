# La app de Android del repartidor

## Qué es y qué no es

Es **una ventana que abre el sitio de siempre**. Adentro del APK no hay una copia
del sistema: hay una pantalla de "no hay internet" y nada más. La app abre
`https://www.logisticadosruedas.com/driver`, el mismo que se usa desde Chrome.

Eso quiere decir que **los cambios se siguen subiendo como siempre**. Se hace
push a `main`, Vercel publica, y la app agarra la versión nueva la próxima vez
que se abre. No hay que reinstalar nada en los celulares, ni sacar una versión
nueva del APK por cada arreglo.

El APK se rehace sólo si cambia algo de esta carpeta: los permisos, el ícono, el
plugin de GPS.

## Para qué existe

Por una sola cosa: **el navegador de un celular congela la página cuando queda
atrás**. Se frenan los relojes y se apaga el GPS. Como el repartidor se pasa el
día en Maps y en WhatsApp, la posición dejaba de llegar por ratos largos —el 14
de agosto hubo un hueco de 105 minutos con paquetes en la calle.

Adentro del APK el GPS lo maneja Android, no el navegador. Sigue avisando con el
celular en el bolsillo y la pantalla apagada.

Todo lo demás —escanear, entregar, las fotos, la caja— es exactamente el mismo
código de siempre.

## Lo que NO cambia

Las reglas siguen viviendo en la base, no en la app:

- `registrar_posicion` (paso 25) sigue guardando **sólo mientras haya trabajo del
  día sin cerrar**. Un domingo la app no registra nada aunque esté instalada.
- Se sigue **borrando sola a las tres horas**.
- Afuera, en el seguimiento del cliente, se sigue publicando la zona aproximada
  y con retraso, nunca el punto exacto.

Y una que agrega Android: mientras el GPS está tomando posiciones, el repartidor
ve **un aviso fijo que no se puede sacar**, diciendo que la app está usando su
ubicación. No es un rastreo escondido y no queremos que lo sea.

No se pide el permiso de "ubicación todo el tiempo", que es el que Android marca
en rojo. Con el permiso normal más el aviso fijo alcanza.

## Los que no tengan Android

Entran por el navegador como hasta ahora y funciona todo igual. La única
diferencia es que van a seguir teniendo los baches de posición, porque Safari
congela igual o peor que Chrome. En el panel se ven exactamente igual: el mapa
lee la posición de la base y no le importa de dónde vino.

---

# Cómo se arma

## Una sola vez, en la máquina

1. **Java 21**

   ```
   winget install --source winget --id Microsoft.OpenJDK.21
   ```

2. **Android Studio** (trae el SDK y el emulador)

   ```
   winget install --source winget --id Google.AndroidStudio
   ```

   Abrirlo una vez, darle *Next* a todo, elegir **Standard** y dejar que baje el
   SDK. Son 5 o 6 GB y hay que esperarlo.

## Cada vez que se arma un APK

Desde `enviosdosruedas/`:

```
npx cap sync android
cd android
./gradlew assembleDebug
```

El APK queda en:

```
android/app/build/outputs/apk/debug/app-debug.apk
```

Ese archivo se le pasa al repartidor por WhatsApp o por cable. Al instalarlo,
Android va a avisar que viene de fuera de la tienda: hay que darle "instalar de
todos modos".

## Para probar sin tocar producción

`capacitor.config.ts` lee la variable **`EDR_APP_URL`**. Sin ella apunta al sitio
real; con ella, a donde se le diga.

Vercel arma una URL sola para cada rama que se sube a GitHub. Se agarra esa y:

```
EDR_APP_URL=https://la-url-de-la-rama.vercel.app npx cap sync android
cd android && ./gradlew assembleDebug
```

Ese APK habla con la rama de prueba y **producción ni se entera**. Además, con
`EDR_APP_URL` puesta se prende el modo depuración: enchufando el celular por
cable se ve la consola de la app en `chrome://inspect`, que es la única forma de
averiguar por qué algo no anda adentro del APK.

Para probar sin ensuciar nada, se entra con el usuario **Prueba**, que ya existe
como repartidor. Lo único que la app escribe por su cuenta es `driver_positions`,
que se borra sola a las tres horas.

## Qué mirar la primera vez que se instala

En este orden, que es de más probable a menos:

1. Que **abra el sitio** y deje entrar con usuario y contraseña.
2. Que el **lector de QR** prenda la cámara. Es lo primero que se rompe en una
   app así, porque el permiso de cámara lo pide Android y no el navegador.
3. Que las **fotos** del comprobante se saquen y suban.
4. Que **lleguen las notificaciones** con la app cerrada. Ver la sección de
   abajo: esto necesita Firebase configurado o no funciona.
5. Que aparezca el **aviso fijo de ubicación** al abrir la hoja de ruta con
   envíos del día.
6. Y la prueba de verdad: **dejar el celular quieto media hora con la app
   cerrada** y mirar si siguen entrando posiciones.

   ```sql
   select taken_at, lat, lng, accuracy_m
     from driver_positions
    order by id desc limit 20;
   ```

---

# Las notificaciones

## Por qué hay dos caminos

El aviso de "te asignaron un envío" viaja por **Web Push**: el navegador entrega
una URL única con dos claves de cifrado y el servidor le manda ahí. Eso funciona
en Chrome y en el Safari de un iPhone.

**Adentro de la app de Android no existe.** Una ventana de app no tiene Web
Push; no es que ande mal, no está implementado. Sin hacer nada, el repartidor con
la app instalada se quedaba mudo sin enterarse.

Android usa Firebase, que entrega otra cosa: un token, un texto solo, sin claves.
Así que ahora hay dos destinos y el servidor le manda por los dos:

| Dónde | Qué se guarda | Tabla |
|---|---|---|
| Chrome, iPhone | la suscripción del navegador | `push_subscriptions` (paso 10) |
| La app de Android | el token de Firebase | `push_tokens` (paso 35) |

Un repartidor puede estar en las dos —la app en el celular y Chrome en la compu—
y recibe en las dos. Repetido no queda: un mismo celular no puede tener ambas.

## Qué hay que configurar, una sola vez

**1. En [console.firebase.google.com](https://console.firebase.google.com):**

- Crear un proyecto. Google Analytics no hace falta.
- Agregar una **app de Android** con este nombre de paquete exacto:
  ```
  com.enviosdosruedas.repartidor
  ```
  El SHA-1 se puede dejar vacío.
- Bajar el **`google-services.json`** y guardarlo en `android/app/`. Ese archivo
  no es secreto: viaja adentro del APK igual. Si no está, el proyecto compila lo
  mismo y las notificaciones quedan apagadas — lo dice al compilar.

**2. Configuración del proyecto → Cuentas de servicio → Generar nueva clave
privada.** Baja un JSON.

**Ese sí es secreto.** Con él cualquiera manda notificaciones en nombre de la
empresa. No va al repositorio ni al chat. Se carga como variable de entorno, con
el JSON entero en una sola línea:

```
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"...", ...}
```

Va en `.env.local` para probar de local, y en Vercel → Settings → Environment
Variables para producción. **Después de agregarla en Vercel hay que volver a
publicar**, porque las variables se leen al construir.

**3. Correr el paso 35** en el SQL Editor de Supabase.

## Cómo saber si quedó bien

Si falta la variable pero hay celulares con la app dados de alta, el servidor lo
grita en los registros de Vercel:

```
[notify] hay tokens de la app pero falta FIREBASE_SERVICE_ACCOUNT.
```

La prueba de verdad, en este orden:

1. Instalar el APK, entrar, ir a **Perfil** y activar los avisos. Tiene que
   aparecer una fila en `push_tokens`.
2. **Cerrar la app del todo** y asignarle un envío desde el panel. El aviso tiene
   que llegar igual.

Ese segundo paso es el que importa. Si el aviso sólo llega con la app abierta, lo
que está andando es otra cosa y Firebase no.
