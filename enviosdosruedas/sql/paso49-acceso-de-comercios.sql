-- ============================================================================
--  PASO 49 — Que cada comercio pueda entrar a ver SUS envíos
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  QUÉ ABRE ESTO. Hasta hoy el comercio pregunta por WhatsApp "¿salió el de
--  Falucho?" y alguien de la oficina va, busca y contesta. Con esto entra con
--  su usuario y lo mira solo: los que están por hacerse, los hechos, los que no
--  se pudieron entregar y los programados para otro día. Con el link de
--  seguimiento para mandarle al cliente y el comprobante de entrega.
--
--  ES SÓLO LECTURA, y esa es la decisión más importante de este paso. El
--  comercio no carga, no edita, no cancela y no borra nada. Lo que ve es lo que
--  la oficina cargó. Un portal de lectura no puede romper una operación; uno
--  que escribe, sí.
--
--  CÓMO SE ATA UN USUARIO A UN COMERCIO. Igual que en stock: una columna
--  `profile_id` en la ficha del comercio. El usuario lo crea el admin desde el
--  panel —crear usuarios necesita la clave de servicio y eso vive en el
--  servidor, nunca en el navegador— y esta columna es el enganche que después
--  usan todos los permisos de abajo.
--
--  LO QUE NO SE TOCA: nada de lo que ya anda. Todas las políticas de acá abajo
--  SUMAN un caso nuevo. El admin sigue viendo todo y el repartidor sigue viendo
--  lo suyo, exactamente igual que antes.
-- ============================================================================

-- ------------------------------------------------------- 1. el enganche
alter table public.clients
  add column if not exists profile_id uuid unique references public.profiles(id) on delete set null;

comment on column public.clients.profile_id is
  'El usuario con el que entra este comercio. Null mientras no tenga acceso. '
  'Lo crea el admin desde el panel (paso 49).';


-- --------------------------------------------------- 2. quién soy, si soy
--
--  Devuelve el id del comercio del que entra, o null si no es un comercio.
--
--  Vive en una función y no repetido en cada política por una razón práctica:
--  el día que haya que cambiar cómo se ata un usuario a un comercio, se cambia
--  acá y no en cinco lugares que ya nadie recuerda que existen.

create or replace function public.mi_comercio()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.clients c where c.profile_id = auth.uid() limit 1;
$$;

grant execute on function public.mi_comercio() to authenticated;


-- ------------------------------------------------ 3. sus envíos, y los suyos
--
--  TODOS los suyos, de cualquier fecha y de cualquier estado: los que están por
--  hacerse, los hechos, los que no se pudieron entregar, los cancelados y los
--  programados para otro día. Un portal que muestra sólo los de hoy obliga a
--  seguir preguntando por los de ayer, y entonces no sirve para nada.

drop policy if exists "el comercio ve sus envios" on public.shipments;
create policy "el comercio ve sus envios"
  on public.shipments for select
  to authenticated
  using (client_id is not null and client_id = public.mi_comercio());


-- --------------------------------------- 4. y el comprobante de cada uno
--
--  Los movimientos son lo que hace que el comprobante exista: la hora, quién
--  recibió, el comentario del repartidor y la ruta de la foto. Sin esto el
--  comercio vería el envío "entregado" y nada más.

drop policy if exists "el comercio ve los movimientos de sus envios" on public.delivery_logs;
create policy "el comercio ve los movimientos de sus envios"
  on public.delivery_logs for select
  to authenticated
  using (
    exists (
      select 1
        from public.shipments s
       where s.id = delivery_logs.shipment_id
         and s.client_id = public.mi_comercio()
    )
  );


-- --------------------------------------------------- 5. su propia ficha
--
--  Para poder saludarlo por su nombre y mostrarle su dirección de retiro. La
--  política del paso 46 ya limita a admin y repartidor: acá se agrega el caso.

drop policy if exists "el comercio ve su ficha" on public.clients;
create policy "el comercio ve su ficha"
  on public.clients for select
  to authenticated
  using (profile_id = auth.uid());


-- ------------------------------------------------- 6. las fotos, las suyas
--
--  El depósito es privado. La foto se guarda en una carpeta con el número del
--  envío —`1234/abc.jpg`— así que el permiso se puede atar exactamente a eso:
--  el comercio ve las fotos de las carpetas que son de sus envíos, y de
--  ninguna otra.
--
--  `storage.foldername(name)` devuelve las carpetas de la ruta; la primera es
--  el número del envío.

drop policy if exists "el comercio ve las fotos de sus envios" on storage.objects;
create policy "el comercio ve las fotos de sus envios"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'delivery-photos'
    and exists (
      select 1
        from public.shipments s
       where s.client_id = public.mi_comercio()
         and s.id::text = (storage.foldername(name))[1]
    )
  );


-- ---------------------------------------------------------------- comprobación
--
--  1. La columna, y quién tiene acceso todavía:
--
--     select name, profile_id from public.clients order by name;
--
--  2. Como vos (admin) tiene que dar null, porque no sos un comercio. Que dé
--     null es la prueba de que la función mira quién pregunta:
--
--     select public.mi_comercio();
--
--  3. Y las políticas nuevas, que tienen que ser cinco:
--
--     select tablename, policyname from pg_policies
--      where policyname like '%comercio%' order by tablename;
