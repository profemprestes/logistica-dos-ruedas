import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // El service worker corre en otro contexto (self, caches, clients),
    // no en el del navegador ni en el de Node: las reglas de acá no aplican.
    "public/sw.js",
    // El proyecto de Android: código Java y archivos que genera Capacitor al
    // compilar. No es nuestro y no se edita a mano, así que revisarlo sólo
    // llena la salida de avisos que nadie va a arreglar nunca.
    "android/**",
  ]),
]);

export default eslintConfig;
