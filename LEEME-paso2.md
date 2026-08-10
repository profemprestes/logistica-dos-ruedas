# Paso 2 — Dashboard del administrador

## 1. Crear el proyecto (una sola vez)

Abrí una terminal en la carpeta donde quieras guardar todo y ejecutá:

```bash
npx create-next-app@latest enviosdosruedas
```

Te va a hacer preguntas. Respondé así:

| Pregunta | Respuesta |
|---|---|
| TypeScript | **Yes** |
| ESLint | Yes |
| Tailwind CSS | **Yes** |
| `src/` directory | **No** |
| App Router | **Yes** |
| Turbopack | Yes |
| import alias (`@/*`) | **No** (deja el que viene) |

Después entrá a la carpeta e instalá las dos librerías que faltan:

```bash
cd enviosdosruedas
npm install @supabase/supabase-js react-qr-code
```

## 2. Copiar los archivos

Copiá los archivos de esta carpeta respetando la estructura:

```
enviosdosruedas/
├─ app/
│  ├─ globals.css          (reemplaza el que ya existe)
│  ├─ layout.tsx           (reemplaza el que ya existe)
│  ├─ login/page.tsx
│  └─ admin/page.tsx
├─ components/
│  ├─ AddShipmentModal.tsx
│  ├─ ShippingLabel.tsx
│  └─ PrintPortal.tsx
└─ lib/
   ├─ supabaseClient.ts
   ├─ format.ts
   └─ parseWhatsapp.ts
```

Las carpetas `components` y `lib` no existen todavía: creálas al lado de `app`.

## 3. Conectar con Supabase

Creá un archivo llamado **`.env.local`** en la raíz del proyecto (al lado de `package.json`) con esto adentro:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

Los dos valores salen de Supabase → **Project Settings → API**: *Project URL* y la clave *anon public*.

## 4. Arrancar

```bash
npm run dev
```

Abrí `http://localhost:3000/login`, entrá con el mail y contraseña que creaste en Supabase, y vas a caer en `/admin`.

## 5. Probar la impresión

1. Cargá un envío.
2. Tocá **Imprimir etiqueta**.
3. En el diálogo del navegador, elegí la impresora térmica y en **Márgenes** poné *Ninguno*. Desactivá *Encabezados y pies de página*.
4. El tamaño ya viene fijado por CSS (`@page size: 100mm 150mm`), así que no toques la escala: dejala en 100%.

Para probar sin impresora térmica, elegí "Guardar como PDF" y fijate que el PDF mida 100 × 150 mm.

## Notas

- **El QR contiene solo el número interno del envío** (ej: `1000`), que es lo que espera la función `scan_and_assign` de la base.
- **El parser nunca guarda solo.** Interpretá → revisá → guardá. Si una línea sale mal, corregila en la pantalla de revisión.
- Cuando tengas 10 mensajes reales pegados y veas qué falla, pasámelos y ajustamos las reglas del parser.
