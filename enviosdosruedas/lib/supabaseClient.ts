import { createClient } from '@supabase/supabase-js';

// Estas dos variables salen de Supabase > Project Settings > API.
// En tu máquina viven en .env.local; en Vercel, en Environment Variables.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Si falta alguna, avisamos por consola y usamos valores de relleno.
// Así la app compila igual y el problema se ve como un error de conexión
// claro, en vez de tumbar todo el build con un mensaje críptico.
if (!url || !anonKey) {
  console.error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Cargalas en .env.local (local) y en Environment Variables (Vercel), y volvé a publicar.'
  );
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key'
);
/** Sirve para mostrar un aviso en pantalla si la app quedó sin configurar. */
export const supabaseConfigured = Boolean(url && anonKey);
