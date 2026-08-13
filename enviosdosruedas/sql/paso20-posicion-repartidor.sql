-- ============================================================================
--  PASO 20 — Dónde va el repartidor, con retraso a propósito
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: la app del repartidor empieza a llamar a
--  `registrar_posicion` apenas sube el código. Sin la función, cada intento
--  falla (no rompe nada, pero no se guarda ninguna posición).
--
--  PARA QUÉ: que el que espera el paquete vea en el seguimiento por dónde
--  anda la moto y cuánto falta, sin que eso se convierta en un rastreador en
--  vivo de un laburante que anda con plata encima.
--
--  LAS TRES REGLAS QUE LO HACEN SEGURO. Ninguna es opcional:
--
--   1. SÓLO EN CAMINO. La función guarda la posición únicamente si el
--      repartidor tiene algo con estado `en_camino`. Terminado el reparto no
--      se guarda más nada: no hay rastro de a qué hora volvió a su casa.
--
--   2. CON RETRASO. La página de seguimiento no muestra la última posición,
--      muestra la más nueva que YA TENGA UNOS MINUTOS. Alguien que mire el
--      link ve por dónde pasó, no dónde está. Ese retraso lo aplica el
--      servidor al leer, no se puede pedir "sin retraso" desde afuera.
--
--   3. SE BORRA SOLA. Cada vez que se guarda una posición se tiran las de más
--      de tres horas del mismo repartidor. No se arma un historial de
--      recorridos de nadie.
--
--  Y una cuarta que vive en el código: al publicarla se redondea a tres
--  decimales, unos cien metros. Alcanza para ver que la moto viene por la
--  zona y no para saber en qué puerta está parada.
-- ============================================================================

create table if not exists public.driver_positions (
  id         bigserial primary key,
  driver_id  uuid not null references public.profiles(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  accuracy_m double precision,
  taken_at   timestamptz not null default now()
);

-- El seguimiento pregunta siempre lo mismo: la última de este repartidor
-- anterior a tal momento. Sin este índice, con el tiempo se recorre la tabla
-- entera en una página pública.
create index if not exists driver_positions_driver_idx
  on public.driver_positions (driver_id, taken_at desc);

comment on table public.driver_positions is
  'Posiciones del repartidor mientras tiene envíos en camino. Se borran solas a las 3 horas.';


-- ------------------------------------------------------- guardar la posición

create or replace function public.registrar_posicion(
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_en_camino boolean;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  -- Coordenadas imposibles: casi siempre un GPS que devolvió cualquier cosa.
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return false;
  end if;

  -- REGLA 1. Sin nada en camino no se guarda. Es acá y no en la app a
  -- propósito: si mañana alguien llama a esta función desde otro lado, la
  -- regla sigue valiendo.
  select exists (
    select 1
      from public.shipments
     where assigned_driver = auth.uid()
       and status = 'en_camino'
  ) into v_en_camino;

  if not v_en_camino then
    return false;
  end if;

  insert into public.driver_positions (driver_id, lat, lng, accuracy_m)
  values (auth.uid(), p_lat, p_lng, p_accuracy_m);

  -- REGLA 3. Se limpia sola, en la misma operación que la guarda.
  delete from public.driver_positions
   where driver_id = auth.uid()
     and taken_at < now() - interval '3 hours';

  return true;
end;
$$;

revoke execute on function public.registrar_posicion(double precision, double precision, double precision)
  from public, anon;
grant execute on function public.registrar_posicion(double precision, double precision, double precision)
  to authenticated;


-- --------------------------------------------------------------------- RLS
--
--  La tabla queda cerrada a todo el mundo salvo el admin. El repartidor NO
--  necesita leerla ni escribirla directo: escribe a través de la función, que
--  es la que aplica las reglas. Y el seguimiento público la lee con la clave
--  de servicio, que no pasa por RLS.

alter table public.driver_positions enable row level security;

drop policy if exists "posiciones: las ve el admin" on public.driver_positions;
create policy "posiciones: las ve el admin"
  on public.driver_positions for select
  to authenticated
  using (public.es_admin());


-- ------------------------------------------------------------------ control
--
--  1. Que la tabla exista y tenga RLS:
--
--     select tablename, rowsecurity from pg_tables
--      where schemaname = 'public' and tablename = 'driver_positions';
--
--  2. Que la función esté y sea una sola:
--
--     select p.oid::regprocedure from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'registrar_posicion';
--
--  3. La prueba de verdad, en la calle: con un envío EN CAMINO tiene que
--     empezar a aparecer una fila por minuto; al cerrarlo, tienen que dejar
--     de aparecer.
--
--     select taken_at, lat, lng from public.driver_positions order by id desc limit 10;
