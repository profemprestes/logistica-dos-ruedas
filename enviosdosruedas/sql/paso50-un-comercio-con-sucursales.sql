-- ============================================================================
--  PASO 50 — TOYPIOLA es TOY PIOLA, y un comercio puede tener sucursales
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  DOS COSAS, y las dos salieron de mirar los envíos de verdad.
--
--  UNA: el mismo comercio escrito de dos formas. El 18/08/2026 se cargó un
--  envío como "TOYPIOLA" y la ficha se llama "TOY PIOLA". Para el sistema eran
--  dos comercios distintos, así que el envío quedó sin enganchar: no salía en
--  el portal del comercio y el repartidor no veía el punto de retiro en el
--  mapa. Un espacio de más.
--
--  OTRA: un comercio con más de un local. Hoy no hay ninguno —se miraron los
--  envíos y las direcciones repetidas son otra cosa: un retiro suelto en una
--  gráfica, o la misma dirección escrita con y sin el piso— pero los va a
--  haber, y conviene que el portal esté listo antes y no después.
--
--  Cada local tiene su dirección, su punto en el mapa y su horario de cierre
--  —son locales distintos, abren distinto— pero para el que entra al portal es
--  UN SOLO COMERCIO y quiere ver todos sus envíos juntos.
--
--  NO SE ROMPE NADA DE LO QUE HAY. Los comercios sin sucursales siguen
--  funcionando igual: `parent_id` queda en null y todo se comporta como antes.
-- ============================================================================


-- ------------------------------------------ 1. el nombre, sin la letra chica
--
--  Una columna que la base calcula sola: el nombre en minúscula, sin acentos y
--  sin nada que no sea letra o número. "TOY PIOLA", "toypiola" y "Toy-Piola"
--  dan todos `toypiola`.
--
--  Se calcula en la base y no en la app a propósito. La app puede tener una
--  versión vieja abierta en un celular; la base es una sola y siempre está al
--  día. Y con el índice único de abajo, la regla deja de depender de que la
--  app se acuerde de aplicarla.
--
--  LOS ACENTOS SE CAMBIAN, NO SE BORRAN, y la diferencia importa. Si a
--  "OLAVARRÍA" le sacáramos la í quedaría `olavarra`, y el día que alguien
--  escriba "OLAVARRIA" sin acento daría `olavarria`: dos claves distintas para
--  el mismo comercio, que es exactamente el problema que esto viene a resolver.
--  Cambiada por i, los dos dan `olavarria`.
--
--  Se hace con `translate` y la lista escrita a mano en vez de con la extensión
--  `unaccent` para no depender de que esté instalada. Son las letras del
--  castellano y no hacen falta más.
--
--  OJO: `claveDeComercio()` en lib/admin/comercios.ts tiene que dar EXACTAMENTE
--  lo mismo que esto. Si se cambia una, se cambia la otra.

alter table public.clients
  add column if not exists nombre_clave text
  generated always as (
    lower(
      regexp_replace(
        translate(
          name,
          'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC'
        ),
        '[^a-zA-Z0-9]', '', 'g'
      )
    )
  ) stored;

comment on column public.clients.nombre_clave is
  'El nombre sin espacios ni signos, para que TOYPIOLA y TOY PIOLA sean el mismo (paso 50).';

-- Antes de crear el índice conviene mirar si hay dos fichas que se pisen:
--
--   select nombre_clave, count(*), string_agg(name, ' / ')
--     from public.clients group by 1 having count(*) > 1;
--
-- El 18/08/2026 no había ninguna. Si algún día aparece, hay que unir esas dos
-- fichas a mano ANTES de correr esto, porque si no el índice no se crea.

create unique index if not exists clients_clave_unica on public.clients (nombre_clave);


-- ---------------------------------------------------- 2. el local de al lado
--
--  Una sucursal es una ficha común y corriente que apunta a su casa central.
--
--  POR QUÉ ASÍ Y NO CON UNA TABLA DE PUNTOS DE RETIRO. Porque una sucursal ES
--  un lugar de retiro con todo lo que eso implica: su dirección, su punto en el
--  mapa, su horario de cierre, sus notas ("tocar timbre del local"). Todo eso
--  ya funciona en la ficha —el mapa la dibuja, el panel avisa cuando está por
--  cerrar, el repartidor la ve— y con esto sigue funcionando igual, sin tocar
--  una línea de nada de eso. Lo único que se agrega es de quién es.
--
--  UN SOLO NIVEL. Una sucursal no tiene sucursales. No es una limitación que
--  moleste —nadie tiene sub-sucursales de un local en Mar del Plata— y evita
--  el árbol que habría que recorrer en cada consulta.

alter table public.clients
  add column if not exists parent_id bigint references public.clients(id) on delete set null;

comment on column public.clients.parent_id is
  'La casa central de esta sucursal. Null si es un comercio suelto o si es la casa central (paso 50).';

create index if not exists clients_parent_idx on public.clients (parent_id);


-- ------------------------------------------------- 3. cuáles son los "míos"
--
--  Antes había `mi_comercio()`, que devolvía uno. Ahora puede haber varios: el
--  del usuario y sus sucursales.
--
--  Si el usuario está atado a una CASA CENTRAL ve la central y todas sus
--  sucursales. Si está atado a una SUCURSAL ve sólo esa. Eso permite las dos
--  cosas que pueden hacer falta: darle el acceso al dueño, que quiere ver
--  todo, o dárselo a un local que se maneja solo.
--
--  ES `security definer` Y NO POR COMODIDAD. Una política sobre `clients` que
--  adentro consulta `clients` se llama a sí misma sin parar y Postgres corta la
--  consulta con un error. Al vivir en una función definidora, la consulta de
--  adentro no vuelve a pasar por las políticas y no hay vuelta.

create or replace function public.mis_comercios()
returns setof bigint
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.clients c where c.profile_id = auth.uid()
  union
  select s.id from public.clients s
   where s.parent_id = (
     select c2.id from public.clients c2 where c2.profile_id = auth.uid() limit 1
   );
$$;

grant execute on function public.mis_comercios() to authenticated;

-- `mi_comercio()` (en singular, del paso 49) se queda como está: sigue
-- sirviendo para preguntar "¿de qué ficha es este usuario?" y lo usa la
-- política de la ficha de acá abajo.


-- ------------------------------------- 4. las mismas puertas, un poco más anchas
--
--  Se reemplazan las tres políticas del paso 49 para que digan "cualquiera de
--  los míos" en vez de "el mío".
--
--  SE BORRA POR NOMBRE EXACTO Y NO EN UN BUCLE. En el paso 46 hubo que barrer
--  todas las de lectura porque había políticas viejas de las que nadie se
--  acordaba. Acá no: estas tres se crearon en el paso 49, se llaman así y no
--  hay otras. Un bucle que borre "las que hablen de comercios" se llevaría
--  puesta la del repartidor, que se llama "el repartidor ve los comercios a los
--  que va" y no tiene nada que ver.

drop policy if exists "el comercio ve sus envios" on public.shipments;
create policy "el comercio ve sus envios"
  on public.shipments for select
  to authenticated
  using (client_id is not null and client_id in (select public.mis_comercios()));

drop policy if exists "el comercio ve los movimientos de sus envios" on public.delivery_logs;
create policy "el comercio ve los movimientos de sus envios"
  on public.delivery_logs for select
  to authenticated
  using (
    exists (
      select 1
        from public.shipments s
       where s.id = delivery_logs.shipment_id
         and s.client_id in (select public.mis_comercios())
    )
  );

drop policy if exists "el comercio ve las fotos de sus envios" on storage.objects;
create policy "el comercio ve las fotos de sus envios"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'delivery-photos'
    and exists (
      select 1
        from public.shipments s
       where s.client_id in (select public.mis_comercios())
         and s.id::text = (storage.foldername(name))[1]
    )
  );


-- ------------------------------------------- 5. y su ficha, y las de sus locales
--
--  El portal necesita leer las sucursales para poder decir de cuál salió cada
--  envío. Sin esto vería los envíos de los dos locales sin poder distinguirlos.

drop policy if exists "el comercio ve su ficha" on public.clients;
create policy "el comercio ve su ficha"
  on public.clients for select
  to authenticated
  using (profile_id = auth.uid() or parent_id = public.mi_comercio());


-- ---------------------------------------------------------------- comprobación
--
--  1. Que TOYPIOLA no se pueda volver a crear al lado de TOY PIOLA:
--
--     insert into public.clients (name) values ('TOYPIOLA');
--     → tiene que dar error de índice único. Si lo da, está bien.
--
--  2. Marcar una sucursal se hace desde el panel, en la ficha del comercio,
--     con "Es sucursal de". Hoy no hay ninguna marcada.
--
--     OJO al mirar direcciones repetidas en los envíos: que un comercio figure
--     con dos direcciones de retiro NO quiere decir que tenga dos locales.
--     WAYFARER figura con MEXICO 2738 y POLONIA 1250 y son un local y un
--     retiro suelto en una gráfica; STARCELL figura con BELGRANO 2875 y
--     BELGRANO 2875 5A, que es la misma dirección escrita de dos formas.
--     Una sucursal la marca una persona, no se adivina de los datos.
--
--  3. Los "míos" como vos (admin) tienen que ser cero, porque no sos comercio:
--
--     select count(*) from public.mis_comercios();
--
--  4. Y las políticas, que tienen que ser cuatro:
--
--     select tablename, policyname from pg_policies
--      where policyname like '%comercio%' order by tablename;
