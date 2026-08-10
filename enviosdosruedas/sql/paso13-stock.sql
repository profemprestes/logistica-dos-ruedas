-- ============================================================================
--  PASO 13 — Control de stock
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  Traduce el sistema que hoy vive en `stock-edr/datos.json` a la base, con la
--  misma lógica: clientes con su prefijo, productos con código correlativo y
--  movimientos de ingreso/egreso. El stock NO se guarda: se calcula sumando los
--  movimientos, igual que hace `stockDe()` en el server.js actual. Así el número
--  nunca puede quedar desincronizado de su propio historial.
-- ============================================================================


-- ------------------------------------------------------------- 1. el rol nuevo
--
--  ¡OJO! `profiles.role` es el enum `user_role`, y Postgres NO deja agregarle un
--  valor dentro de la misma transacción en la que se usa. Por eso esta línea va
--  SOLA, en una consulta aparte, ANTES de correr todo el resto:
--
--      alter type public.user_role add value if not exists 'comercio';
--
--  Corré esa línea primero, dale Run, y recién después pegá el resto del archivo.
--  Si ya la corriste antes, no pasa nada: no hace nada la segunda vez.

comment on column public.profiles.role is
  'admin | repartidor | comercio';


-- --------------------------------------------------------------- 2. clientes
create table if not exists public.stock_clients (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,

  -- Con prefijo 'SH' y sufijo 'EDR' los códigos salen SH00000001EDR.
  prefijo    text not null,
  sufijo     text not null default 'EDR',
  -- Último número usado. Lo maneja `siguiente_codigo_producto()`.
  contador   integer not null default 0,

  -- Usuario del comercio. Puede quedar en null hasta que se le cree el acceso.
  profile_id uuid unique references public.profiles(id) on delete set null,

  activo     boolean not null default true,
  created_at timestamptz not null default now()
);


-- -------------------------------------------------------------- 3. productos
create table if not exists public.stock_products (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.stock_clients(id) on delete cascade,
  nombre     text not null,
  codigo     text not null unique,
  -- Debajo de este número el producto se marca en rojo.
  minimo     integer not null default 0,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists stock_products_client_idx on public.stock_products (client_id);


-- ------------------------------------------------------------ 4. movimientos
create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.stock_clients(id) on delete cascade,
  product_id  uuid not null references public.stock_products(id) on delete cascade,

  tipo        text not null check (tipo in ('ingreso', 'egreso')),
  -- Siempre positiva: el signo lo pone `tipo`. Guardar negativos invita a que
  -- alguien reste dos veces.
  cantidad    integer not null check (cantidad > 0),

  fecha       date not null default current_date,
  nota        text,

  -- ACÁ está la ganancia de unificar: cuando el descuento viene de una entrega
  -- real, queda apuntado a ese envío y no hace falta pegar el mensaje dos veces.
  shipment_id bigint references public.shipments(id) on delete set null,

  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index if not exists stock_movements_product_idx on public.stock_movements (product_id);
create index if not exists stock_movements_client_idx  on public.stock_movements (client_id, fecha desc);


-- ------------------------------------------------------- 5. el stock de hoy
-- Vista: suma los movimientos. Es la traducción exacta de `stockDe()`.
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

-- ¡OJO! Sin esta línea la vista consulta las tablas con los permisos de quien
-- la creó (vos, admin) y no con los de quien pregunta. Es decir: un comercio
-- pidiendo `stock_actual` sin filtro vería el stock de TODOS los clientes,
-- aunque las políticas de más abajo digan lo contrario. `security_invoker`
-- hace que la vista respete el RLS de la tabla para cada usuario.
--
-- Si ya corriste el paso 13 antes de que existiera esta línea, corré sólo
-- esta sentencia: alcanza y no rompe nada.
alter view public.stock_actual set (security_invoker = on);


-- --------------------------------------------------- 6. código correlativo
-- Atajo que usan tanto la función de acá abajo como las políticas del punto 7:
-- ¿el que está preguntando es admin? Va primero porque las dos lo necesitan.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- Incrementa el contador y devuelve el código, todo en una sola operación:
-- si dos personas cargan un producto a la vez, no salen dos códigos iguales.
create or replace function public.siguiente_codigo_producto(p_client_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente public.stock_clients;
begin
  -- Es `security definer`: sin este control, cualquier usuario logueado podría
  -- llamarla y adelantar el contador de un cliente ajeno. No podría crear el
  -- producto (el RLS no lo deja), pero dejaría huecos en la numeración.
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  update public.stock_clients
     set contador = contador + 1
   where id = p_client_id
   returning * into v_cliente;

  if v_cliente.id is null then
    raise exception 'CLIENTE_NO_ENCONTRADO';
  end if;

  return v_cliente.prefijo
      || lpad(v_cliente.contador::text, 8, '0')
      || coalesce(v_cliente.sufijo, 'EDR');
end;
$$;

grant execute on function public.siguiente_codigo_producto(uuid) to authenticated;


-- ------------------------------------------------------------------ 7. RLS
alter table public.stock_clients   enable row level security;
alter table public.stock_products  enable row level security;
alter table public.stock_movements enable row level security;

-- (`es_admin()` se define arriba, en el punto 6.)

-- El admin maneja todo.
drop policy if exists "admin maneja clientes de stock" on public.stock_clients;
create policy "admin maneja clientes de stock" on public.stock_clients
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admin maneja productos" on public.stock_products;
create policy "admin maneja productos" on public.stock_products
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admin maneja movimientos" on public.stock_movements;
create policy "admin maneja movimientos" on public.stock_movements
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- El comercio SÓLO LEE lo suyo, y sólo si le creaste usuario (profile_id).
-- No hay ni una política de insert, update ni delete para él: aunque alguien
-- manipule la app desde el navegador, la base no lo deja escribir nada. Quien
-- carga y descuenta mercadería sos vos, en el depósito.
drop policy if exists "comercio ve su ficha" on public.stock_clients;
create policy "comercio ve su ficha" on public.stock_clients
  for select to authenticated using (profile_id = auth.uid());

drop policy if exists "comercio ve sus productos" on public.stock_products;
create policy "comercio ve sus productos" on public.stock_products
  for select to authenticated
  using (client_id in (select id from public.stock_clients where profile_id = auth.uid()));

drop policy if exists "comercio ve sus movimientos" on public.stock_movements;
create policy "comercio ve sus movimientos" on public.stock_movements
  for select to authenticated
  using (client_id in (select id from public.stock_clients where profile_id = auth.uid()));


-- ============================================================================
--  Los datos que ya tenés en datos.json NO se migran solos. Son 2 clientes y
--  2 productos: conviene cargarlos a mano desde la pantalla nueva, así de paso
--  la probás. Si más adelante son muchos, armamos el importador.
-- ============================================================================
