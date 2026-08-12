-- ============================================================================
--  PASO 17 — Cerrarle las funciones al visitante anónimo
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  Viene de los avisos del linter de Supabase. Dos cosas distintas:
--
--  1) `search_path` suelto en tres funciones. Se arregla con ALTER, sin tocar
--     el cuerpo de ninguna.
--
--  2) LO IMPORTANTE: toda función creada en `public` queda, por defecto,
--     ejecutable por PUBLIC — y el rol `anon` (el visitante sin loguear)
--     hereda de ahí. Nuestros `grant execute ... to authenticated` sumaban
--     permiso, pero nunca sacaron el que ya venía puesto. Resultado: cualquiera
--     puede llamar /rest/v1/rpc/loquesea sin estar logueado.
--
--     La mayoría se salva sola porque adentro chequea `auth.uid()`. Pero hay
--     dos que quedaron de una versión vieja del sistema —`register_delivery` y
--     `register_failed_delivery`, reemplazadas hace rato por `resolve_delivery`—
--     que NO están en el repo y de las que no sabemos si chequean sesión.
--     Depender de que cada una se defienda sola es al revés: la puerta se
--     cierra una vez, acá.
-- ============================================================================


-- ------------------------------------------------- 1. search_path fijo
--
--  `set_updated_at` y `set_tracking_code` son del armado original y no están
--  en el repo; `fecha_local` la escribimos nosotros en el paso 14 y se me
--  pasó. ALTER les fija el search_path sin reescribirlas.
alter function public.fecha_local()      set search_path = public;
alter function public.set_updated_at()   set search_path = public;
alter function public.set_tracking_code() set search_path = public;


-- --------------------------------- 2. sacarle el permiso al anónimo
--
--  Se recorren TODAS las funciones `security definer` de `public`, incluidas
--  las que no están en el repo, y se les saca el permiso heredado. Después se
--  devuelve el permiso a `authenticated`, para no romperle nada a nadie que
--  esté logueado: el único que pierde acceso es el visitante sin sesión.
--
--  ¡OJO! El `grant` de vuelta es a propósito. Varias políticas de RLS llaman a
--  `es_admin()` (y puede que alguna vieja llame a `is_admin()`), y una política
--  se evalúa con los permisos de quien consulta: si le sacáramos el EXECUTE a
--  `authenticated`, las consultas empezarían a fallar en vez de filtrar.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format('revoke execute on function %s from public', f.firma);
    execute format('revoke execute on function %s from anon',   f.firma);
    execute format('grant  execute on function %s to authenticated', f.firma);
  end loop;
end $$;


-- ----------------------------- 3. las de trigger no las llama nadie a mano
--
--  Estas cuatro sólo tienen sentido disparadas por su trigger. Postgres pide
--  el permiso EXECUTE al CREAR el trigger, no cada vez que se dispara, así que
--  sacárselo ahora no los apaga: siguen funcionando igual.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public'
       and t.typname = 'trigger'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
  end loop;
end $$;


-- ============================================================================
--  DESPUÉS DE CORRER ESTO, PROBÁ (son 2 minutos y cubren todo lo que se tocó):
--
--   1. Cargá un envío desde el panel   -> prueba set_tracking_code y los triggers
--   2. Cerrá una entrega desde el celu -> prueba resolve_delivery
--   3. Abrí /stock con un comercio     -> prueba es_admin() dentro de las RLS
--
--  Si algo tira "permission denied for function", avisá: se arregla con un
--  `grant execute on function <la que sea> to authenticated;`.
--
--  QUEDA PENDIENTE, a mano y con cuidado: `register_delivery` y
--  `register_failed_delivery` son código muerto (la app usa `resolve_delivery`
--  desde el paso 3). Conviene borrarlas, pero NO desde acá: si algún celular
--  quedó con una versión vieja de la app guardada, todavía podría llamarlas y
--  perdería la entrega. Primero confirmá que todos los repartidores abrieron
--  la app nueva, y recién ahí:
--      drop function if exists public.register_delivery(bigint, text, text, text, double precision, double precision, uuid, double precision, numeric, timestamptz, boolean);
--      drop function if exists public.register_failed_delivery(bigint, public.failure_reason, text, double precision, double precision, uuid, text, double precision, timestamptz, boolean);
-- ============================================================================
