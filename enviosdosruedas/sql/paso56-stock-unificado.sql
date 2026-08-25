-- ============================================================================
--  PASO 56 — El stock se unifica con los comercios y los envíos
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  EL PROBLEMA. El stock del paso 13 vivía en una isla: tenía SU propia lista
--  de clientes (`stock_clients`) aparte de los comercios de verdad
--  (`clients`), y descontar mercadería era pegar el mensaje de entregas a mano
--  en otra pantalla — el mismo mensaje que ya se había pegado para cargar los
--  envíos. Dos listas del mismo mundo y el mismo texto dos veces.
--
--  LO QUE QUEDA. Un solo lugar: el comercio de `clients` se marca "maneja
--  stock en base", sus productos cuelgan de él, y cada envío suyo lleva su
--  pedido —producto y cantidad, elegidos de un listado al cargarlo—. El
--  descuento lo hace la base sola CUANDO EL ENVÍO PASA A ENTREGADO, por
--  trigger: da igual si lo entregó el repartidor desde el celular, si se marcó
--  desde el panel o si se corrigió después — todos los caminos pasan por el
--  mismo update de status.
--
--  POR QUÉ SE PUEDE TIRAR LO VIEJO. Al 25/08/2026 las tablas del paso 13 están
--  vacías: un solo cliente de prueba ("Prueba"), cero productos, cero
--  movimientos. No hay nada que migrar, así que se recrean apuntando a
--  `clients` directamente, que es lo que el paso 13 habría hecho si los
--  comercios hubieran existido entonces.
-- ============================================================================


-- ------------------------------------------------- 1. la marca en el comercio

alter table public.clients
  add column if not exists maneja_stock   boolean not null default false,
  -- Con prefijo 'CN' los códigos salen CN00000001EDR.
  add column if not exists stock_prefijo  text,
  -- Último número usado. Lo maneja `siguiente_codigo_producto()`.
  add column if not exists stock_contador integer not null default 0;

comment on column public.clients.maneja_stock is
  'Guarda mercadería en nuestro depósito: sus envíos llevan pedido y el entregado descuenta stock (paso 56).';


-- ------------------------------------------- 2. afuera las tablas del paso 13
--
--  La vista primero, que depende de las tablas. `stock_movements` antes que
--  `stock_products` antes que `stock_clients`, por las FK.

drop view if exists public.stock_actual;
drop table if exists public.stock_movements;
drop table if exists public.stock_products;
drop table if exists public.stock_clients;


-- ------------------------------------------------------------- 3. productos

create table if not exists public.stock_products (
  id         uuid primary key default gen_random_uuid(),
  client_id  bigint not null references public.clients(id) on delete cascade,
  nombre     text not null,
  codigo     text not null unique,
  -- Debajo de este número el producto se marca en rojo.
  minimo     integer not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists stock_products_client_idx on public.stock_products (client_id);


-- ----------------------------------------------------------- 4. movimientos

create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  client_id   bigint not null references public.clients(id) on delete cascade,
  product_id  uuid not null references public.stock_products(id) on delete cascade,

  tipo        text not null check (tipo in ('ingreso', 'egreso')),
  -- Siempre positiva: el signo lo pone `tipo`. Guardar negativos invita a que
  -- alguien reste dos veces.
  cantidad    integer not null check (cantidad > 0),

  fecha       date not null default current_date,
  nota        text,

  -- Cuando el egreso lo generó una entrega real, queda apuntado al envío.
  shipment_id bigint references public.shipments(id) on delete set null,

  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index if not exists stock_movements_product_idx  on public.stock_movements (product_id);
create index if not exists stock_movements_client_idx   on public.stock_movements (client_id, fecha desc);
create index if not exists stock_movements_shipment_idx on public.stock_movements (shipment_id);


-- --------------------------------------------- 5. el pedido que lleva el envío
--
--  La línea "este envío lleva 2 de Óxido nítrico". Se elige de un listado al
--  cargar el envío — nada de adivinar desde el texto — y es lo que el trigger
--  descuenta cuando el envío se entrega.

create table if not exists public.shipment_products (
  id          bigint generated always as identity primary key,
  shipment_id bigint not null references public.shipments(id) on delete cascade,
  product_id  uuid not null references public.stock_products(id) on delete cascade,
  cantidad    integer not null check (cantidad > 0),

  -- Un producto por envío una sola vez: "Nad x2" es UNA línea con cantidad 2,
  -- no dos líneas. Sin esto, corregir una línea desde la pantalla sería
  -- adivinar cuál de las dos.
  unique (shipment_id, product_id)
);

create index if not exists shipment_products_shipment_idx on public.shipment_products (shipment_id);


-- ------------------------------------------------------- 6. el stock de hoy
--  Vista: suma los movimientos. El stock NO se guarda: se calcula, así el
--  número nunca queda desincronizado de su propio historial.

create or replace view public.stock_actual as
select
  p.id            as product_id,
  p.client_id,
  p.nombre,
  p.codigo,
  p.minimo,
  p.activo,
  coalesce(sum(case when m.tipo = 'egreso' then -m.cantidad else m.cantidad end), 0)::integer
                  as stock
from public.stock_products p
left join public.stock_movements m on m.product_id = p.id
group by p.id;

-- Sin esto la vista consulta con los permisos de quien la creó (vos, admin) y
-- un comercio vería el stock de TODOS. Con esto respeta el RLS de cada uno.
alter view public.stock_actual set (security_invoker = on);


-- --------------------------------------------------- 7. código correlativo

-- La versión del paso 13 recibía uuid (los clientes de stock viejos). Sin este
-- drop quedarían las dos y cualquier llamada sería ambigua.
drop function if exists public.siguiente_codigo_producto(uuid);

create or replace function public.siguiente_codigo_producto(p_client_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente public.clients;
begin
  -- Es `security definer`: sin este control, cualquier usuario logueado podría
  -- adelantar el contador de un comercio ajeno.
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  update public.clients
     set stock_contador = stock_contador + 1
   where id = p_client_id
  returning * into v_cliente;

  if v_cliente.id is null then
    raise exception 'COMERCIO_NO_ENCONTRADO';
  end if;

  if not v_cliente.maneja_stock or coalesce(trim(v_cliente.stock_prefijo), '') = '' then
    raise exception 'SIN_STOCK_EN_BASE';
  end if;

  return upper(trim(v_cliente.stock_prefijo))
      || lpad(v_cliente.stock_contador::text, 8, '0')
      || 'EDR';
end;
$$;

grant execute on function public.siguiente_codigo_producto(bigint) to authenticated;


-- ------------------------------------------------------------------ 8. RLS
--
--  El admin maneja todo. El comercio LEE lo suyo — y "suyo" se decide por
--  `clients.profile_id`, el mismo enganche del portal (paso 49): una sola
--  forma de decir quién es quién.

alter table public.stock_products   enable row level security;
alter table public.stock_movements  enable row level security;
alter table public.shipment_products enable row level security;

/*
 * Se borran en un bucle sobre `pg_policies` y no por nombre: en esta base
 * conviven políticas hechas a mano con las de los pasos, y los permisos SUMAN
 * — basta una sobrante para que la restricción nueva no sirva de nada.
 */
do $$
declare t text; p record;
begin
  foreach t in array array['stock_products', 'stock_movements', 'shipment_products']
  loop
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
  end loop;
end $$;

create policy "admin maneja productos" on public.stock_products
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy "el comercio ve sus productos" on public.stock_products
  for select to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = stock_products.client_id and c.profile_id = auth.uid()
  ));

create policy "admin maneja movimientos" on public.stock_movements
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

create policy "el comercio ve sus movimientos" on public.stock_movements
  for select to authenticated
  using (exists (
    select 1 from public.clients c
     where c.id = stock_movements.client_id and c.profile_id = auth.uid()
  ));

create policy "admin maneja pedidos" on public.shipment_products
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- El comercio ve qué llevan sus envíos; el repartidor no necesita esta tabla
-- (el detalle del paquete ya viaja en el envío como texto).
create policy "el comercio ve sus pedidos" on public.shipment_products
  for select to authenticated
  using (exists (
    select 1 from public.stock_products p
    join public.clients c on c.id = p.client_id
    where p.id = shipment_products.product_id and c.profile_id = auth.uid()
  ));


-- --------------------------------- 9. el descuento, cuando se entrega de verdad
--
--  Va por trigger sobre el estado del envío y no en el código de ninguna
--  pantalla: a 'entregado' se llega desde el celular del repartidor, desde el
--  panel (paso 22) y corrigiendo un cierre (paso 23), y con el trigger todos
--  los caminos descuentan igual — incluso los que se inventen después.
--
--  `security definer`: el que dispara el update puede ser el repartidor, y el
--  RLS de `stock_movements` no lo deja escribir. El descuento es de la base,
--  no de quien aprieta el botón.

create or replace function public.stock_al_entregar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'entregado'::public.shipment_status
     and old.status is distinct from new.status then
    /*
     * Idempotente: si este envío ya descontó una vez (entregado → corregido →
     * entregado otra vez), no vuelve a descontar. El movimiento apuntado al
     * envío es la marca de que ya pasó.
     */
    insert into public.stock_movements (client_id, product_id, tipo, cantidad, fecha, nota, shipment_id)
    select p.client_id, sp.product_id, 'egreso', sp.cantidad,
           public.fecha_local(), 'Descontado al entregar', new.id
      from public.shipment_products sp
      join public.stock_products p on p.id = sp.product_id
     where sp.shipment_id = new.id
       and not exists (
         select 1 from public.stock_movements m
          where m.shipment_id = new.id and m.tipo = 'egreso'
       );
  end if;

  /*
   * El camino de vuelta: un "entregado" que se corrige deja de haber pasado,
   * así que su descuento también. Se BORRA el egreso automático en vez de
   * escribir un ingreso de contrapartida: el stock es la suma de lo que pasó,
   * y esto no pasó. Sólo se tocan los automáticos — un movimiento cargado a
   * mano nunca se borra solo.
   */
  if old.status = 'entregado'::public.shipment_status
     and new.status is distinct from old.status then
    delete from public.stock_movements
     where shipment_id = new.id
       and tipo = 'egreso'
       and nota = 'Descontado al entregar';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_al_entregar on public.shipments;
create trigger trg_stock_al_entregar
  after update of status on public.shipments
  for each row
  execute function public.stock_al_entregar();


-- ------------------------------------- 10. el reprogramado hereda su pedido
--
--  Al reprogramar nace un envío nuevo del MISMO paquete (`reintento_de`, paso
--  31). Sin esto, el envío nuevo saldría sin pedido y su entrega no
--  descontaría nada. Va por trigger y no adentro de `reprogramar_envio` para
--  no reescribir esa función — que ya la pisamos mal una vez (paso 27).
--
--  El original no había descontado (nunca llegó a entregado), así que acá no
--  hay doble descuento posible: descuenta el que finalmente se entregue.

create or replace function public.stock_heredar_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reintento_de is not null then
    insert into public.shipment_products (shipment_id, product_id, cantidad)
    select new.id, sp.product_id, sp.cantidad
      from public.shipment_products sp
     where sp.shipment_id = new.reintento_de
    on conflict (shipment_id, product_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stock_heredar_pedido on public.shipments;
create trigger trg_stock_heredar_pedido
  after insert on public.shipments
  for each row
  execute function public.stock_heredar_pedido();

commit;

-- ============================================================
-- PARA MIRAR DESPUÉS DE CORRERLO
--
-- 1) Las columnas nuevas del comercio:
--      select id, name, maneja_stock, stock_prefijo, stock_contador
--        from public.clients order by name;
--
-- 2) Marcar a Conectta (id 31) — esto también se puede desde la pantalla:
--      update public.clients
--         set maneja_stock = true, stock_prefijo = 'CN'
--       where id = 31;
--
-- 3) Que los triggers estén vivos:
--      select tgname from pg_trigger
--       where tgrelid = 'public.shipments'::regclass and tgname like 'trg_stock%';
-- ============================================================
