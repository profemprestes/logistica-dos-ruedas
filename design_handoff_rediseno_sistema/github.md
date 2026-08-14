repo: dosruedasmdq/logistica-dos-ruedas
branch: main
path: enviosdosruedas

## Last sync
date: 2026-08-14T21:57:20Z

### Updated in this project
- Sistema de diseño completo (Sistema Completo.dc.html): fundamentos, componentes, palabra, superficie pública (portada, seguimiento, comprobante, etiqueta 100×150 mm) y mapa de las 22 pantallas.
- Panel del admin rediseñado (Panel Admin.dc.html): panel del día nuevo, avisos de atraso con acción, buscador "dónde está mi paquete" con ETA, y las 10 secciones navegables.
- App del repartidor rediseñada con la identidad de marca + pantallas nuevas de caja y cola sin señal.
- Recreación 1:1 de las 9 pantallas actuales de `/driver`.
- Logos `logo-simple.webp` y `logo-completo.webp` copiados del repo.

## Screen map
| Pantalla del proyecto | Archivos del repo |
| --- | --- |
| Actual · Login | app/login/page.tsx, components/Logo.tsx |
| Actual · Hoja de ruta | app/driver/dashboard/page.tsx, components/driver/ShipmentCard.tsx, DriverShell.tsx |
| Actual · Detalle del envío | components/driver/ShipmentSheet.tsx, MiniMapa.tsx, lib/format.ts |
| Actual · Cerrar entrega / No entregado | components/driver/ResolveDeliveryModal.tsx, PhotoInput.tsx |
| Actual · Escáner QR | components/driver/QrScannerModal.tsx |
| Actual · Mapa del día | app/driver/mapa/page.tsx, components/MapaEnvios.tsx |
| Actual · Mi perfil | app/driver/profile/page.tsx, lib/settlement.ts |
| Actual · Permisos | components/driver/PermissionGate.tsx |
| Rediseño repartidor (todas) | los anteriores + app/globals.css, app/driver/layout.tsx |
| Admin · Panel del día | app/admin/page.tsx (resumen, faltaUbicar, ATAJOS), lib/eta.ts, lib/format.ts |
| Admin · Envíos | app/admin/page.tsx, components/admin/ShipmentMobileCard.tsx, components/AdminNav.tsx |
| Admin · Nuevo envío | components/AddShipmentModal.tsx, lib/parseWhatsapp.ts |
| Admin · Mapa en vivo | app/admin/mapa/page.tsx, components/MapaEnvios.tsx, lib/eta.ts |
| Admin · Repartidores | app/admin/drivers/page.tsx |
| Admin · Cierre de caja | app/admin/billing/page.tsx, lib/settlement.ts |
| Admin · Resúmenes | app/admin/resumenes/page.tsx, lib/resumen.ts (REGLAS: comisión 30%, Shippy) |
| Admin · Estadísticas | app/admin/stats/page.tsx |
| Admin · Stock | app/admin/stock/page.tsx, components/stock/* |
| Admin · Prueba de entrega | components/ProofOfDeliveryModal.tsx, lib/proof.ts |
| Público · Portada | app/page.tsx, components/TrackBox.tsx, components/SiteFooter.tsx |
| Público · Seguimiento y comprobante | app/seguimiento/[codigo]/page.tsx, lib/trackServer.ts, lib/eta.ts, components/ProofOfDelivery.tsx |
| Público · Etiqueta 100×150 mm | components/ShippingLabel.tsx, components/LabelLogo.tsx, app/globals.css (@page 100mm 150mm) |
| Sistema de diseño (fundamentos) | app/globals.css (tokens --edr-*), app/layout.tsx, lib/format.ts (STATUS_CLASS, marcaDeEstado) |
