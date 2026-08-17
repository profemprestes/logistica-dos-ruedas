-- ============================================================================
--  PASO 39 — Colectas: mandar a alguien a retirar a un comercio
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  QUÉ ES UNA COLECTA. Un repartidor, una dirección y una nota. Nada más.
--  "Emiliano, pasá por Independencia 2684, son 3 paquetes."
--
--  POR QUÉ NO ES UN ENVÍO. Porque el envío se lo asigna el escaneo, y eso está
--  bien: el repartidor se lleva lo que el comercio le da. Pero entonces, antes
--  de escanear, el envío no existe para él — y alguien tiene que decirle a
--  dónde ir. Hoy eso vive en un WhatsApp, y el repartidor tiene que saltar de
--  la app al chat y volver.
--
--  Y HAY ALGO QUE SÓLO SE PUEDE ASÍ: la colecta no depende de que los envíos
--  estén cargados. Se le puede avisar que pase por un comercio antes de subir
--  una sola etiqueta. Con envíos eso es imposible.
--
--  NO TOCA NADA DE LO QUE YA ANDA. Ni los envíos, ni el escaneo, ni la hoja de
--  ruta. Vive al lado.
-- ============================================================================

create table if not exists public.colectas (
  id          bigint generated always as identity primary key,

  -- Siempre tiene destinatario. Se decidió así y no "abierta para el que
  -- pueda": el reparto se coordina por WhatsApp igual, y una colecta sin dueño
  -- necesitaría un mecanismo de "voy yo" para que no vayan dos.
  driver_id   uuid not null references public.profiles(id) on delete cascade,

  -- La dirección tal como se escribe. Texto libre a propósito: los comercios
  -- todavía no son una tabla, y esperar a que lo sean sería no tener esto.
  direccion   text not null,
  comercio    text,
  nota        text,

  -- El punto, para el mapa. Se busca al crearla y puede corregirse a mano.
  -- Puede quedar en null: hay direcciones que no geocodifican ("BASE",
  -- "TERMINAL PLUSMAR") y eso no puede impedir mandar a alguien a retirar.
  lat         double precision,
  lng         double precision,

  fecha       date not null default public.fecha_local(),

  /*
   * Se cierra cuando el repartidor toca "ya retiré". A mano y no sola.
   *
   * Cerrarla automáticamente al escanear el primer paquete sería tentador y
   * está mal: si el comercio le da 3 de los 5 que había, la colecta se daría
   * por hecha con dos paquetes todavía en el mostrador.
   */
  hecha_at    timestamptz,
  creada_por  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.colectas is
  'Instrucciones de retiro: a quién, a dónde y qué. No son envíos y no los tocan (paso 39).';

-- Lo que pregunta la app veinte veces por día: las mías de hoy sin hacer.
create index if not exists colectas_pendientes_idx
  on public.colectas (driver_id, fecha)
  where hecha_at is null;


-- --------------------------------------------------------------------- RLS

alter table public.colectas enable row level security;

-- El repartidor ve las suyas y sólo puede marcarlas hechas. No puede crearlas
-- ni cambiarles la dirección: eso lo decide la oficina.
drop policy if exists "el repartidor ve sus colectas" on public.colectas;
create policy "el repartidor ve sus colectas"
  on public.colectas for select
  to authenticated
  using (driver_id = auth.uid() or public.es_admin());

drop policy if exists "el repartidor la marca hecha" on public.colectas;
create policy "el repartidor la marca hecha"
  on public.colectas for update
  to authenticated
  using (driver_id = auth.uid() or public.es_admin())
  with check (driver_id = auth.uid() or public.es_admin());

drop policy if exists "las colectas las crea el admin" on public.colectas;
create policy "las colectas las crea el admin"
  on public.colectas for insert
  to authenticated
  with check (public.es_admin());

drop policy if exists "las colectas las borra el admin" on public.colectas;
create policy "las colectas las borra el admin"
  on public.colectas for delete
  to authenticated
  using (public.es_admin());


-- --------------------------------------------- marcar hecha, sin poder mentir
--
--  Va por función y no por un update suelto para que la hora la ponga el
--  servidor. Con un update desde la app, un celular con la hora cambiada
--  escribiría cualquier cosa, y esa hora es la que después se mira para
--  entender por qué un comercio quedó sin retirar.

create or replace function public.marcar_colecta_hecha(p_id bigint)
returns public.colectas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_colecta public.colectas;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  select * into v_colecta from public.colectas where id = p_id;

  if v_colecta.id is null then
    raise exception 'COLECTA_NO_ENCONTRADA';
  end if;

  if v_colecta.driver_id <> auth.uid() and not public.es_admin() then
    raise exception 'COLECTA_DE_OTRO';
  end if;

  -- Marcarla dos veces no la mueve: la hora que vale es la de la primera.
  if v_colecta.hecha_at is not null then
    return v_colecta;
  end if;

  update public.colectas
     set hecha_at = now()
   where id = p_id
   returning * into v_colecta;

  return v_colecta;
end;
$$;

revoke execute on function public.marcar_colecta_hecha(bigint) from public, anon;
grant execute on function public.marcar_colecta_hecha(bigint) to authenticated;


-- ------------------------------------------------------------------ control
--
--  1. Que la tabla esté con RLS:
--
--     select tablename, rowsecurity from pg_tables
--      where schemaname = 'public' and tablename = 'colectas';
--
--  2. Las que están pendientes ahora mismo:
--
--     select p.full_name, c.direccion, c.comercio, c.nota, c.fecha
--       from public.colectas c join public.profiles p on p.id = c.driver_id
--      where c.hecha_at is null order by c.fecha desc;
--
--  3. La prueba de verdad: crear una desde el panel y que le aparezca al
--     repartidor arriba de la hoja de ruta. Al tocar "ya retiré" tiene que
--     desaparecer de la app y quedar con hora en la consulta de arriba.
