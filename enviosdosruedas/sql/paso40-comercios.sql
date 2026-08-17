-- ============================================================================
--  PASO 40 — Los comercios, con su punto
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  LA TABLA YA EXISTÍA Y NADIE LA USABA. `clients` se creó en algún paso viejo
--  con nombre, teléfono, dirección de retiro y notas, y quedó vacía: los envíos
--  guardan el comercio como texto suelto en `client_name_raw` y
--  `pickup_address`. La columna `client_id` de los envíos también estaba,
--  esperando. Esto termina lo que aquello empezó.
--
--  QUÉ CAMBIA. Hasta ahora la dirección de retiro se escribía a mano en cada
--  envío. Con 33 envíos de un mismo comercio eso es escribir 33 veces lo mismo,
--  y que en algunas quede "guemes 2945" y en otras "Güemes 2945" — dos
--  comercios distintos para cualquier cosa que quiera agruparlos.
--
--  Y sobre todo: LOS ENVÍOS NO TIENEN PUNTO DE RETIRO. Guardan una sola
--  coordenada, la de la entrega. Por eso el mapa del repartidor dibuja los
--  paquetes que todavía no retiró en la casa del cliente, y el "cómo llegar" lo
--  manda ahí — a entregar algo que todavía no tiene en la moto. El punto vive
--  acá, se busca una vez por comercio y se corrige una vez.
-- ============================================================================

-- ------------------------------------------------------------ 1. el punto

alter table public.clients
  add column if not exists lat double precision,
  add column if not exists lng double precision;

comment on column public.clients.lat is
  'Punto del comercio, para el mapa y el cómo llegar. Se busca al crearlo y se puede corregir a mano (paso 40).';

/*
 * Un comercio por nombre, sin importar mayúsculas ni espacios de más.
 *
 * Es lo que evita que "Toy Piola" se cargue dos veces por escribirlo distinto,
 * que es exactamente lo que pasó con el texto suelto: en el historial conviven
 * TOY PIOLA y TOYPIOLA para el mismo lugar.
 */
create unique index if not exists clients_nombre_unico
  on public.clients (lower(trim(name)));

-- Se busca por nombre al cargar un envío, y se listan los activos primero.
create index if not exists clients_activos_idx on public.clients (active, name);


-- --------------------------------------------------------------------- RLS
--
--  El repartidor los LEE —el mapa necesita el punto del comercio y la ficha del
--  envío muestra el nombre— pero no los toca. Cargarlos y corregirlos es de la
--  oficina.

alter table public.clients enable row level security;

drop policy if exists "los comercios los ve cualquiera con sesión" on public.clients;
create policy "los comercios los ve cualquiera con sesión"
  on public.clients for select
  to authenticated
  using (true);

drop policy if exists "los comercios los maneja el admin" on public.clients;
create policy "los comercios los maneja el admin"
  on public.clients for all
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());


-- ------------------------------------------------ 2. el envío apunta al suyo
--
--  `client_id` ya existía. Lo único que faltaba era que apuntara a algo y que
--  no se pudiera romper: si alguien borra un comercio, los envíos viejos no
--  pueden desaparecer con él.

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where constraint_name = 'shipments_client_id_fkey'
       and table_name = 'shipments'
  ) then
    alter table public.shipments
      add constraint shipments_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;
end $$;

create index if not exists shipments_client_idx
  on public.shipments (client_id) where client_id is not null;


-- ------------------------------------------------------------------ control
--
--  1. Que la tabla tenga el punto y RLS:
--
--     select column_name from information_schema.columns
--      where table_name = 'clients' and column_name in ('lat','lng');
--
--     select rowsecurity from pg_tables
--      where schemaname='public' and tablename='clients';
--
--  2. Después de la carga inicial, cuántos quedaron y cuántos con punto:
--
--     select count(*) as comercios,
--            count(lat) as con_punto
--       from public.clients;
--
--  3. Y qué envíos quedaron enganchados a su comercio:
--
--     select c.name, count(s.id)
--       from public.clients c left join public.shipments s on s.client_id = c.id
--      group by 1 order by 2 desc;
