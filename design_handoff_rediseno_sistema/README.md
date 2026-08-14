# Handoff: Rediseño del sistema Envíos DosRuedas (app del repartidor + panel del admin)

## Overview
Rediseño completo del sistema de gestión de envíos: la app del repartidor (`/driver`), el panel de
oficina (`/admin`), la superficie pública (portada, seguimiento, comprobante) y la etiqueta térmica
100×150 mm. Objetivos acordados:

1. Aplicar la identidad de marca real (Anton / Bebas Neue / Outfit, #0636A5 + #FFEC01) sin cambiar el flujo.
2. Usabilidad de calle: una mano, con guantes, sol directo, señal intermitente, celulares viejos.
3. Pantallas que faltaban: caja del día del repartidor, cola de entregas sin señal y **panel del día**
   para la oficina, con avisos de atraso y buscador "dónde está mi paquete".
4. El repartidor arma el orden de su ruta arrastrando tarjetas.

Volumen real: ~50 envíos/día, 3 repartidores, 1 persona en la oficina. El cierre de caja **siempre** lo
hace el admin, y tiene que poder hacerlo desde el celular.

## About the Design Files
Los archivos `.dc.html` de este bundle son **referencias de diseño**: prototipos en HTML que muestran el
aspecto y el comportamiento buscados. **No son código para copiar y pegar.** La tarea es **recrear estos
diseños dentro del codebase existente** —Next.js 16 (App Router) + React 19 + Tailwind v4 + Supabase—
usando sus patrones actuales: `'use client'`, componentes en `components/`, consultas con `supabase` de
`lib/supabaseClient`, y los tokens CSS de `app/globals.css`.

Los prototipos usan estilos inline y datos de ejemplo porque son maquetas; en el repo va Tailwind y datos
reales de Supabase. Abrilos en el navegador mientras implementás (necesitan `support.js`, incluido).

## Fidelity
**Alta fidelidad (hifi).** Colores, tipografías, tamaños, radios, sombras y copy son definitivos:
recrear pixel-perfect con Tailwind. Los mapas son placeholders — en el repo ya existe `MapaEnvios`
(Leaflet + OpenStreetMap) y es lo que debe usarse.

## Archivos de diseño incluidos
| Archivo | Qué contiene |
| --- | --- |
| `Sistema Completo.dc.html` | Fundamentos (color, tipografía, forma, movimiento, iconografía, palabra), componentes, superficie pública nueva (portada, seguimiento, comprobante, etiqueta 100×150 mm) y mapa de las 22 pantallas |
| `App Repartidor.dc.html` | App del repartidor: 10 pantallas navegables + modo Reordenar |
| `Panel Admin.dc.html` | Panel de oficina: 10 secciones navegables + versión celular del panel del día |
| `App Repartidor - Actual (recreación).dc.html` | Recreación 1:1 de las 9 pantallas actuales de `/driver`, para comparar antes/después |
| `github.md` | Asociación con el repo y mapa pantalla → archivos |

## Design Tokens
Casi todos ya existen en `app/globals.css`. Lo que hay que agregar está marcado como NUEVO.

### Color
| Token | Valor | Uso |
| --- | --- | --- |
| `--edr-blue` | #0636A5 | azul de marca, fondo institucional, botón secundario |
| `--edr-yellow` | #FFEC01 | **sólo** plata y acción principal |
| `--edr-blue-dark` | #00277C | ink, secciones densas |
| `--edr-dark` (NUEVO) | #001035 | shell de la app, barras, sidebar del panel |
| `--edr-surface` | #042C86 | tarjetas sobre azul |
| `--edr-surface-2` | #072A72 | encabezados |
| `--edr-border` | #2A58C4 | bordes sobre azul |
| `--edr-muted` | #B7CBFF | texto secundario sobre azul |
| `--edr-blue-soft` | #E6EEFE | fondo de los paneles claros del admin |
| `--edr-accent` (NUEVO) | #0950F6 | acento, "tu posición" en el mapa |
| panel claro (NUEVO) | #FFFFFF · #F5F8FF · #C9D9FB · #DBE6FD · #EEF3FE | superficie, zebra, hairline, separadores |
| texto sobre claro (NUEVO) | #0F172A · #3B4457 · #5B6B85 · #7288AD · #4B6BB5 · #9AABC7 | jerarquía de texto en el panel |

**Regla dura: sobre amarillo el texto es siempre #0636A5.** Nunca blanco ni negro.

### Estados (chips) — mismos valores en las tres superficies
```
CREADO               bg #EEF3FE  text #4B6BB5
PENDIENTE DE RETIRO  bg #FEF3C7  text #92400E
RETIRADO             bg #E0F2FE  text #075985
EN CAMINO            bg #DBEAFE  text #1E40AF
ENTREGADO            bg #DCFCE7  text #166534
NO ENTREGADO         bg #FFEDD5  text #9A3412
CANCELADO            bg #FEE2E2  text #991B1B
```
En el mapa son sólo tres + gris, como ya hace `marcaDeEstado()` en `lib/format.ts`: amarillo pendiente,
verde #059669 entregado, rojo #DC2626 no entregado, gris #737373 cancelado.
Semánticos de alerta: rojo #DC2626, naranja #EA580C, verde #059669, WhatsApp #25D366.

### Tipografía
- **Anton 400** — titulares y direcciones. Mayúscula, `letter-spacing:-.02em`, line-height .9–1.05. **Nunca cifras.**
- **Bebas Neue 400** — botones, chips, encabezados de tabla, rótulos. `letter-spacing:.05–.1em`, siempre mayúscula.
- **Outfit 400–700** — texto corrido, campos, listas (la única que hoy carga `app/layout.tsx`).
- **Mono del sistema** (`.edr-mono`, ya existe) — cifras, códigos, horas. `font-variant-numeric:tabular-nums`, `letter-spacing:-.03em`.

Agregar Anton y Bebas Neue con `next/font/google` en `app/layout.tsx`, expuestas como `--font-anton` y
`--font-bebas` junto a `--font-outfit`.

### Tamaños mínimos
- Calle: dirección 29px, acción 20px, cuerpo 15px, rótulo 13px; **ningún control menor a 56px**.
- Oficina: celda 13.5px, encabezado 13px; fila cómoda 14px de padding vertical, compacta 9px.
- Etiqueta térmica: todo en mm — dirección 6mm, destinatario 4.6mm, código 5mm, QR 30mm, mínimo 2.4mm.

### Forma, sombra, movimiento
- Radios: 8 (chips y botones chicos) · 16 (campos) · 20/24 (tarjetas) · 9999px (píldora) para toda acción principal.
- Sombra dura de marca: `4px 4px 0 #0742CA`, sólo en acción principal y tarjetas de plata. No hay sombras negras.
- Bordes: hairline 1px #C9D9FB sobre claro, `rgba(255,255,255,.12)` sobre azul. Foco: borde amarillo + halo 3px al 25%.
- Curvas: spring `cubic-bezier(.34,1.56,.64,1)`, smooth `cubic-bezier(.25,.8,.25,1)`. .2s hover, .3s tarjetas.
- Press: `active:scale-95` en todo control táctil. Respetar `prefers-reduced-motion`.

### Iconografía
**Lucide** (`lucide-react`), trazo 2px, 12–24px, **un solo tono por ícono**: amarillo sobre azul,
#0636A5 sobre amarillo. **Cero emoji en la UI** — hoy los emoji hacen de iconografía en toda la app del
repartidor y hay que reemplazarlos uno por uno:
📷 → `Camera`/`ScanLine` · 📦 → `Package`/`PackageCheck` · 🛵 → `Bike` · ✅ → `Check`/`CheckCheck` ·
⚠️ → `AlertTriangle` · 🗺️🧭 → `Navigation`/`Map` · 📞 → `Phone` · 💬 → `MessageCircle` · 📍 → `MapPin` ·
🔔 → `Bell` · ⟳ → `RefreshCw` · 🗓️ → `CalendarClock` · ⛔ → `ShieldAlert` · 🖼️ → `Image` · 🔗 → `Link` · 🖨 → `Printer`.

## Screens / Views — App del repartidor
Shell: fondo #001035, encabezado con isotipo + wordmark Anton bicolor ("ENVÍOS" blanco / "DOSRUEDAS"
amarillo), chip de señal y avatar. **Navegación fija abajo** (Ruta · Mapa · [ESCANEAR] · Caja · Perfil),
con el botón de escaneo circular de 72px, amarillo, elevado (`margin-top:-26px`) y borde de 4px del color
del fondo. Contenido scrolleable entre header y nav.

### 1. Login
Fondo #0636A5. Isotipo 44px + wordmark. Etiqueta "APP DE REPARTO" (Bebas 15px amarillo), titular Anton
38px "SISTEMA DE / GESTIÓN / DE ENVÍOS" (última línea amarilla). Campos píldora #E6EEFE con texto #00277C.
Botón "CONECTARSE": píldora amarilla, Bebas 26px, sombra dura. Nota: la app pide cámara y GPS.

### 2. Hoja de ruta (principal)
- Título Anton 26px "HOJA DE RUTA" + contador mono `hechos/total` amarillo.
- Barra de progreso 8px: riel `rgba(255,255,255,.12)`, relleno amarillo, transición .3s smooth.
- Línea Bebas "JUEVES 14 · N POR HACER" + botón **REORDENAR** (borde amarillo; sólido en modo orden).
- Píldora amarilla "A COBRAR HOY" + monto mono 22px con sombra dura → navega a Caja.
- Chip de cola si hay entregas guardadas (borde amarillo, fondo `rgba(255,236,1,.1)`) → pantalla Cola.
- **Tarjeta de envío**: fondo #0636A5, borde `rgba(255,255,255,.12)`, radio 24px, sombra dura, padding 16px,
  gap 12px. Orden del contenido: código mono 12px #B7CBFF + chip de estado; comercio Bebas 15px amarillo;
  **dirección Anton 29px blanca**; piso/depto Outfit 16px; destinatario · ventana Outfit 15px #B7CBFF;
  aviso FLEX (fondo #E6EEFE, texto #00277C, ícono `Camera`); franja de retiro si el estado es
  `pendiente_retiro` (`rgba(255,255,255,.08)`, `Package` amarillo); franja de cobro amarilla con
  "COBRAR EN LA PUERTA / AL RETIRAR" + monto mono 26px.
  Pie: botón principal de 56px amarillo según estado (`pendiente_retiro` → "YA LO RETIRÉ" `PackageCheck`;
  `retirado` → "SALGO EN CAMINO" `Bike`; `en_camino` → "CERRAR ENTREGA" `Check`) + dos circulares de 56px
  (`Phone`, `Navigation`).
- "CERRADOS HOY · N" plegable, filas compactas (`CheckCircle2` #34D399 / `XCircle` #F87171).
- "PRÓXIMOS DÍAS · N": tarjetas con borde punteado, opacidad .75, sin botones (la base los rechaza igual).

### 3. Modo Reordenar (nuevo)
Reemplaza la lista por filas compactas: manija `GripVertical` (chip 34px), número de puesto en mono,
dirección Anton 20px truncada, estado + cobro en Outfit 12.5px, y **dos botones de 48px** (`ChevronUp`,
`ChevronDown`). Fila `draggable`, con `opacity:.5` y borde amarillo mientras se arrastra. Arriba, aviso
punteado explicando arrastre y flechas. Abajo, botón amarillo "LISTO, ASÍ VOY".

### 4. Detalle del envío
Volver (Bebas + `ChevronLeft`) · comercio + estado · dirección Anton 36px · código mono. Tarjeta de cobro
amarilla (monto mono 52px + desglose envío/mercadería). Tarjeta de retiro (#0636A5, `Package`, notas).
Dos tarjetas chicas (destinatario / ventana). Mini-mapa 150px con pin #0636A5 borde amarillo y leyenda
"Referencia aproximada". Acciones: LLAMAR · WHATSAPP (ícono #25D366) · CÓMO LLEGAR A DESTINO (ancho completo).
Al pie: **ENTREGADO** (píldora amarilla 68px, Bebas 26px) y **NO SE PUDO ENTREGAR** (borde amarillo, 56px).

### 5–6. Cerrar entrega / No entregado
Pasos numerados en Bebas: "1 · FOTO …", "2 · QUIÉN RECIBE", "3 · DNI" (o "2 · MOTIVO" en el fallido).
Tile de cámara 132px con borde punteado amarillo; máximo 2 fotos, botón × de 32px. Motivos como chips de
52px (los cinco de `FAILURE_REASONS`), el elegido en amarillo pleno. Comentario con tres sugerencias de un
toque. Línea "Ubicación tomada (±12 m)" con `MapPin`. Error sobre #DC2626 con `AlertCircle`. Confirmación:
botón amarillo de 68px.
Validación: foto siempre obligatoria; nombre y DNI si es entregado y no es FLEX; motivo si es fallido.
FLEX entregado: sin nombre ni DNI, con foto del paquete y la fachada.

### 7. Escáner
Pantalla negra con radial `#1B2333 → #000`, visor 74% con cuatro esquinas amarillas de 5px, rótulo Bebas
20px "APUNTÁ AL QR DE LA ETIQUETA", botón amarillo de 64px, campo de código a mano en mono y "CERRAR".
Mantener `html5-qrcode` y el cuidado actual de apagar el stream al cerrar.

### 8. Mapa del día
Mapa 400px (Leaflet) con **pines sólo de color, sin números** (amarillo/verde/rojo), 36px con borde blanco
de 3px, y la posición propia en #0950F6 con halo. Leyenda de cuatro entradas. Tarjeta "EL ORDEN LO ARMÁS
VOS": la app no impone recorrido.

### 9. Caja del día
Chips de período (Hoy · Ayer · Semana). Tarjeta amarilla "TENÉS QUE RENDIR" con monto mono 56px. Dos tiles
(entregados / no entregados). Panel "DE DÓNDE SALE" con los cuatro renglones —**los mismos nombres que usa
el admin en `/admin/billing`**— y franja "TE QUEDA A FAVOR" sobre #001035.

### 10. Cola sin señal
Entregas guardadas (`CloudUpload` amarillo, código · hora · "con foto", etiqueta "EN ESPERA") y botón
"REINTENTAR AHORA". Copy: se suben solas, no hace falta hacer nada.

### 11. Perfil
Avatar amarillo 64px con iniciales, tres tiles (entrega · semana · puntaje), fila de notificaciones con
switch 56×32 (thumb 24px, transición spring), tres filas de ajustes, "SALIR DE LA CUENTA", versión.

## Screens / Views — Panel del admin
Shell 1440px: **sidebar 236px** #001035 (isotipo + wordmark, 9 ítems radio 10px, activo #0636A5, badge rojo
con el número de atrasos, pie con usuario y `LogOut`) + **topbar #0636A5** (buscador píldora #E6EEFE de
520px con `Search` y el rótulo "DÓNDE ESTÁ MI PAQUETE", fecha, chip verde de repartidores en calle, botón
amarillo "+ NUEVO ENVÍO") + **contenido sobre #E6EEFE** con paneles blancos radio 20/24 y hairline #C9D9FB.

1. **Panel del día** — 5 tiles (envíos, en la calle, entregados, sin salir, con atraso); panel "NECESITA
   ATENCIÓN" con una fila por aviso (barra de color 5×38px, tipo en Bebas, detalle, desde, y botón de acción
   con borde azul); "LOS TRES, AHORA" con tarjeta por repartidor (avatar, zona + edad del GPS, `hechos/total`,
   barra de progreso, franja amarilla "LLEVA $", aviso rojo si el GPS está viejo); columna derecha con
   tarjeta amarilla "A COBRAR HOY" y el widget **"DÓNDE ESTÁ MI PAQUETE"** sobre #001035: campo, resultado
   con línea de tiempo de 5 pasos, caja "LLEGADA APROXIMADA", botones COPIAR RESPUESTA / PRUEBA y el mensaje
   ya redactado para WhatsApp.
   **Las cuatro reglas de atraso** (explícitas, en servidor o cliente): sin asignar; asignado y sin retirar
   pasado el corte de 15 hs (o >4 h); en camino hace más de 90 minutos; no entregado sin reprogramar.
2. **Envíos** — atajos de fecha, filtros de repartidor y estado, total a cobrar; barra de selección sobre
   #001035 (asignar en lote, copiar seguimientos, imprimir etiquetas, bajar fotos); tabla en grid
   `34px 118px 1.3fr 1.6fr 150px 150px 110px 225px`, encabezado #F5F8FF, filas con hairline #EEF3FE, fila
   seleccionada #F5F8FF, chip de estado, "Sin asignar" en rojo, monto mono a la derecha y acciones
   (PRUEBA + `Pencil`, `Printer`, `Link`, `Trash2`).
3. **Nuevo envío** — dos columnas: textarea mono para pegar el mensaje del comercio + botón "INTERPRETAR
   N LÍNEA(S)"; a la derecha, una tarjeta por envío interpretado, con **borde amarillo y campo resaltado
   cuando falta un dato**. Reusar `lib/parseWhatsapp.ts`.
4. **Mapa en vivo** — mapa 600px con pines de color y motos como círculos #0636A5 con borde amarillo e
   iniciales; rail derecho con próxima parada y botones SEGUIR / WHATSAPP.
5. **Repartidores** — tabla con avatar, teléfono mono, vehículo, `hechos/total`, chip ACTIVO y acciones
   (CAJA DEL DÍA / EDITAR / DESACTIVAR).
6. **Cierre de caja** — chips de repartidor + fecha + estado (BORRADOR / LIQUIDADO); tabla de movimientos
   (hora, código, destinatario, chip de evento, efectivo); panel derecho "CERRAR EL DÍA" con los cuatro
   renglones editables, franja de saldo (#DC2626 a rendir / #059669 a cobrar) y botón amarillo.
   **Tiene que funcionar en celular**: por debajo de 900px, los renglones y el saldo van primero en una
   columna y los movimientos se vuelven tarjetas.
7. **Resúmenes** — tabla de pedidos con la columna "COMISIÓN" mostrando la regla aplicada (30% o
   SHIPPY · SIN COMISIÓN) y panel oscuro con el texto listo en `<pre>` mono, modos Detallado / Compacto y
   botón de copiar. Usar `lib/resumen.ts` tal cual: los números que salen de ahí son los que se pagan.
8. **Estadísticas** — 4 tiles (el de efectivo en amarillo), barras horizontales por estado y tabla por repartidor.
9. **Stock** — selector de cliente sobre #001035, pestañas con subrayado amarillo de 3px, tabla con el stock
   en rojo/naranja cuando está bajo y acciones + INGRESO / − EGRESO.
10. **Prueba de entrega** (modal 840px) — encabezado #0636A5 con `ShieldCheck`; dos fotos de 210px; cuatro
    datos (recibió, DNI, cobró, GPS); comentario; mapa 160px; línea de tiempo; COPIAR LINK PARA EL COMERCIO
    y BAJAR COMPROBANTE PDF.

## Superficie pública
- **Portada** (`app/page.tsx`): titular Anton 40px, tarjeta amarilla con campo de código en mono y botón azul
  "SEGUIR ENVÍO", tres píldoras de contexto, bloque de cierre hacia enviosdosruedas.com.
- **Seguimiento en camino**: tarjeta amarilla con estado Anton 34px + "Llega aproximadamente entre X e Y
  minutos" + edad de la última señal; mapa con **círculo de 500 m** (celda de `aproximarPunto`) y pin del
  domicilio; recorrido de 4 hitos; datos de entrega; botón WhatsApp #25D366.
- **Comprobante**: tarjeta verde #DCFCE7 con fecha y quién recibió, foto, mapa del punto de entrega y CTA a
  la web comercial. **Nunca** plata, teléfono ni DNI (mantener el criterio de `lib/trackServer.ts`).
- **Etiqueta 100×150 mm**: blanco y negro macizo, todo en mm. QR 30mm, código mono 5mm, "DE" con el comercio,
  "ENTREGAR A" con dirección 6mm, localidad en chip negro 3.8mm, datos adicionales con `max-height:14mm`, y
  bloque negro "COBRAR AL ENTREGAR" con monto mono 9mm **sólo si se cobra en la puerta**.

## Interactions & Behavior
- **Reordenar la ruta (nuevo)**: `draggable` en cada fila + `onDragStart / onDragOver / onDrop / onDragEnd`,
  más flechas ↑/↓ de 48px para usar con guantes. **Atención**: el handler de `drop` puede dispararse más de
  una vez, así que la operación debe ser **idempotente** — guardá al empezar el arrastre un snapshot del
  orden y calculá el resultado siempre desde ese snapshot, no desde el orden vivo (si no, la tarjeta queda
  una posición corrida y los arrastres sucesivos acumulan el error). Persistir el orden en IndexedDB junto
  al caché de la ruta; si se decide compartirlo con el panel, agregar una columna `route_order` a `shipments`.
- **Estado de señal**: banda amarilla con `WifiOff` cuando no hay conexión, contador de cola, entregas
  guardadas en IndexedDB que se reintentan solas (ya implementado en `lib/driver/*`).
- **Press**: `active:scale-95` en todo control táctil; hover sólo en el panel.
- **Toasts**: píldora #001035 con `CheckCircle2` amarillo, 3–4 s, por encima de la nav.
- **Navegación**: cambiar de sección sin recargar (una recarga en `/driver` re-dispara el pedido de permisos).

## State Management
Repartidor: `screen`, `envios` (con su orden), `selId`, `kind`, campos del formulario (`nombre`, `dni`,
`comentario`, `motivo`, `fotos`), `error`, `toast`, `offline`, `cola`, `verCerrados`, `periodo`, `modoOrden`,
`arrastrando`. Todo lo que ya existe (sesión, caché, borradores, posición) se mantiene: el rediseño no
cambia la lógica de datos.
Admin: `screen`, filtros (`desde`, `hasta`, `driver`, `estado`, `search`), `seleccion`, `q` del buscador
público, `verProof`, `caja` (repartidor elegido), `modo` del resumen, `tab` de stock.

## Assets
- `logo-simple.webp` (isotipo, 30–44px) y `logo-completo.webp` — ya están en `public/` (incluidos acá).
- El wordmark no es imagen: es texto Anton en dos colores ("ENVÍOS" blanco / "DOSRUEDAS" amarillo).
- Íconos: Lucide. No hay ilustraciones ni fotos propias en el sistema.

## Orden de implementación sugerido
1. Fuentes (Anton + Bebas en `app/layout.tsx`) y tokens nuevos en `app/globals.css`.
2. Reemplazar emoji por Lucide en `components/driver/*` (cambio mecánico, mejora inmediata).
3. Shell del repartidor: nav inferior fija + header nuevo (`DriverShell`, `app/driver/layout.tsx`).
4. `ShipmentCard` y hoja de ruta (`app/driver/dashboard/page.tsx`).
5. Modo Reordenar (idempotencia del drop + persistencia del orden).
6. `ShipmentSheet` y `ResolveDeliveryModal` con los pasos numerados.
7. Caja del día del repartidor (separar `app/driver/profile` en `/driver/caja` y `/driver/perfil`).
8. Panel del admin: shell (sidebar + topbar) y **Panel del día** con las cuatro reglas de atraso.
9. Buscador "dónde está mi paquete", reusando `lib/trackServer.ts` y `lib/eta.ts`.
10. Tabla de envíos y el resto de las secciones sobre paneles claros.
11. Etiqueta y superficie pública.

## Mapa pantalla → archivos del repo
| Diseño | Archivos a modificar |
| --- | --- |
| Shell + nav del repartidor | `components/driver/DriverShell.tsx`, `app/driver/layout.tsx` |
| Hoja de ruta + Reordenar | `app/driver/dashboard/page.tsx`, `components/driver/ShipmentCard.tsx`, `lib/driver/db.ts` |
| Detalle | `components/driver/ShipmentSheet.tsx`, `components/driver/MiniMapa.tsx` |
| Cierre / No entregado | `components/driver/ResolveDeliveryModal.tsx`, `components/driver/PhotoInput.tsx`, `components/driver/CamaraModal.tsx` |
| Escáner | `components/driver/QrScannerModal.tsx` |
| Mapa del día | `app/driver/mapa/page.tsx`, `components/MapaEnvios.tsx` |
| Caja del repartidor | `app/driver/profile/page.tsx`, `lib/settlement.ts` |
| Cola sin señal | `lib/driver/sync.ts`, `lib/driver/db.ts` |
| Permisos | `components/driver/PermissionGate.tsx` |
| Login | `app/login/page.tsx` |
| Shell del panel | `components/AdminNav.tsx` (pasa a sidebar) |
| Panel del día (nuevo) | `app/admin/page.tsx` (o `app/admin/panel/page.tsx`), `lib/eta.ts` |
| Envíos | `app/admin/page.tsx`, `components/admin/ShipmentMobileCard.tsx` |
| Nuevo envío | `components/AddShipmentModal.tsx`, `lib/parseWhatsapp.ts` |
| Mapa en vivo | `app/admin/mapa/page.tsx` |
| Repartidores | `app/admin/drivers/page.tsx` |
| Cierre de caja | `app/admin/billing/page.tsx` |
| Resúmenes | `app/admin/resumenes/page.tsx`, `lib/resumen.ts` |
| Estadísticas | `app/admin/stats/page.tsx` |
| Stock | `app/admin/stock/page.tsx`, `components/stock/*` |
| Prueba de entrega | `components/ProofOfDeliveryModal.tsx`, `components/ProofOfDelivery.tsx` |
| Portada y seguimiento | `app/page.tsx`, `app/seguimiento/[codigo]/page.tsx`, `components/TrackBox.tsx` |
| Etiqueta | `components/ShippingLabel.tsx`, `components/LabelLogo.tsx` |

## Decisiones ya tomadas (no re-preguntar)
- El **orden de la ruta lo decide el repartidor**; el sistema no lo impone.
- El **cierre de caja lo hace siempre el admin**, desde cualquier dispositivo → el panel debe ser usable en celular.
- **No hay pantalla del comercio**: se maneja con el link de seguimiento y el de etiqueta.
- **Aviso automático al destinatario**: push web no sirve para quien espera el paquete (no instaló nada; en
  iPhone exige agregar el sitio a la pantalla de inicio). El camino es WhatsApp con el link de seguimiento:
  de un toque desde la app hoy, automático si se contrata la API de WhatsApp Business.
- La **deuda heredada** de `components/ui/*` (paleta vieja #0C3BA7 / #071F5C / #092C7E) se unifica en esta
  pasada con la paleta vigente.

## Cómo usarlo con Claude Code
```bash
# 1. copiá esta carpeta dentro del repo
cp -r design_handoff_rediseno_sistema /ruta/al/repo/

# 2. abrí Claude Code en la raíz del repo
claude
```

Prompts sugeridos, **uno por vez** (no le pidas todo junto):

1. `Leé design_handoff_rediseno_sistema/README.md. Implementá sólo el paso 1: agregá Anton y Bebas Neue con next/font/google en app/layout.tsx y los tokens de color nuevos en app/globals.css. No toques componentes todavía.`
2. `Paso 2: reemplazá todos los emoji de components/driver/* por íconos de lucide-react según la tabla de equivalencias del README. Sin cambiar layout ni lógica.`
3. `Pasos 3 y 4: rediseñá DriverShell y ShipmentCard según la sección "Screens / Views — App del repartidor". Usá design_handoff_rediseno_sistema/App Repartidor.dc.html como referencia visual. Mantené intacta la lógica de estados, caché y cola offline.`
4. `Paso 5: agregá el modo Reordenar a la hoja de ruta. Leé la advertencia de idempotencia del drop en el README y persistí el orden en IndexedDB.`
5. `Paso 8: convertí AdminNav en sidebar y creá el Panel del día con las cuatro reglas de atraso descritas en el README, usando Panel Admin.dc.html como referencia.`

Consejos: abrí los `.dc.html` en el navegador mientras trabajás; pedile que corra `npm run lint` y
`npm run build` después de cada paso; y hacé un commit por paso.
