-- ============================================================================
--  PASO 3 — App del repartidor
--  Pegá TODO esto en Supabase → SQL Editor → Run. Se puede correr más de una vez.
-- ============================================================================

-- ---------------------------------------------------------------- 1. columnas
-- Cuándo se cerró el envío y, si no se pudo entregar, por qué.
alter table public.shipments
  add column if not exists delivered_at   timestamptz,
  add column if not exists failure_reason text;


-- ------------------------------------------------------------------ 2. tabla
-- Cada intento de entrega del repartidor: el comprobante de lo que pasó en la calle.
create table if not exists public.delivery_events (
  id               bigint generated always as identity primary key,

  -- Lo genera el celular ANTES de tener señal. Es la clave de la idempotencia:
  -- si la cola offline reintenta el mismo evento, no se duplica.
  client_event_id  uuid        not null unique,

  shipment_id      bigint      not null references public.shipments(id) on delete cascade,
  driver_id        uuid        not null references public.profiles(id),

  kind             text        not null check (kind in ('entregado', 'no_entregado')),
  reason           text,          -- motivo cuando no se pudo entregar
  receiver_name    text,          -- quién recibió
  receiver_dni     text,

  lat              double precision,
  lng              double precision,
  accuracy_m       double precision,

  photo_path       text,          -- ruta dentro del bucket 'comprobantes'

  -- Cuándo pasó en la calle (NO cuándo se sincronizó: pueden ser horas distintas).
  happened_at      timestamptz not null,
  created_at       timestamptz not null default now()
);

create index if not exists delivery_events_shipment_idx on public.delivery_events (shipment_id);
create index if not exists delivery_events_driver_idx   on public.delivery_events (driver_id, happened_at desc);


-- -------------------------------------------------------------------- 3. RLS
alter table public.delivery_events enable row level security;

drop policy if exists "repartidor ve sus eventos" on public.delivery_events;
create policy "repartidor ve sus eventos"
  on public.delivery_events for select
  to authenticated
  using (
    driver_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- El alta pasa siempre por resolve_delivery(), no por insert directo.
drop policy if exists "nadie inserta a mano" on public.delivery_events;


-- --------------------------------------------------------- 4. escanear el QR
-- El QR de la etiqueta trae el id interno ("1000"), pero aceptamos también el
-- código de seguimiento por si alguna etiqueta vieja anda dando vueltas.
create or replace function public.scan_and_assign(p_code text)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
begin
  if auth.uid() is null then
    raise exception 'Sesión vencida: volvé a entrar.';
  end if;

  select * into v_shipment
  from public.shipments
  where (p_code ~ '^\d+$' and id = p_code::bigint)
     or upper(tracking_code) = upper(trim(p_code))
  limit 1;

  if v_shipment.id is null then
    raise exception 'No encontramos ese envío. ¿El QR es de otra empresa?';
  end if;

  if v_shipment.status = 'entregado' then
    raise exception 'Ese envío ya figura como entregado.';
  end if;

  if v_shipment.status = 'cancelado' then
    raise exception 'Ese envío está cancelado: no lo lleves.';
  end if;

  if v_shipment.assigned_driver is not null and v_shipment.assigned_driver <> auth.uid() then
    raise exception 'Ese envío ya está asignado a otro repartidor.';
  end if;

  update public.shipments
     set assigned_driver = auth.uid(),
         assigned_at     = coalesce(assigned_at, now()),
         status          = 'en_camino'
   where id = v_shipment.id
   returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke all on function public.scan_and_assign(text) from public;
grant execute on function public.scan_and_assign(text) to authenticated;


-- ------------------------------------------------------- 5. cerrar la entrega
-- Guarda el comprobante y mueve el estado en una sola operación.
-- Es idempotente: si la cola offline manda dos veces el mismo client_event_id,
-- la segunda no hace nada y devuelve el envío como quedó.
create or replace function public.resolve_delivery(
  p_client_event_id uuid,
  p_shipment_id     bigint,
  p_kind            text,
  p_happened_at     timestamptz,
  p_reason          text             default null,
  p_receiver_name   text             default null,
  p_receiver_dni    text             default null,
  p_lat             double precision default null,
  p_lng             double precision default null,
  p_accuracy_m      double precision default null,
  p_photo_path      text             default null
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
  v_inserted boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Sesión vencida: volvé a entrar.';
  end if;

  if p_kind not in ('entregado', 'no_entregado') then
    raise exception 'Tipo de cierre inválido: %', p_kind;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'El envío % ya no existe.', p_shipment_id;
  end if;

  if v_shipment.assigned_driver is distinct from auth.uid() then
    raise exception 'Ese envío no es tuyo: lo tiene otro repartidor.';
  end if;

  insert into public.delivery_events (
    client_event_id, shipment_id, driver_id, kind, reason,
    receiver_name, receiver_dni, lat, lng, accuracy_m, photo_path, happened_at
  )
  values (
    p_client_event_id, p_shipment_id, auth.uid(), p_kind, p_reason,
    p_receiver_name, p_receiver_dni, p_lat, p_lng, p_accuracy_m, p_photo_path, p_happened_at
  )
  on conflict (client_event_id) do nothing;

  get diagnostics v_inserted = row_count;

  -- Evento repetido (reintento de la cola): el estado ya se movió, no lo tocamos.
  if not v_inserted then
    return v_shipment;
  end if;

  update public.shipments
     set status         = case when p_kind = 'entregado' then 'entregado' else 'pendiente_entrega' end,
         delivered_at   = case when p_kind = 'entregado' then p_happened_at else delivered_at end,
         failure_reason = case when p_kind = 'entregado' then null else p_reason end
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke all on function public.resolve_delivery(uuid, bigint, text, timestamptz, text, text, text, double precision, double precision, double precision, text) from public;
grant execute on function public.resolve_delivery(uuid, bigint, text, timestamptz, text, text, text, double precision, double precision, double precision, text) to authenticated;


-- ------------------------------------------------------ 6. fotos comprobante
insert into storage.buckets (id, name, public)
values ('comprobantes', 'comprobantes', false)
on conflict (id) do nothing;

drop policy if exists "repartidor sube comprobantes" on storage.objects;
create policy "repartidor sube comprobantes"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'comprobantes');

drop policy if exists "comprobantes: ve el que subió y el admin" on storage.objects;
create policy "comprobantes: ve el que subió y el admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'comprobantes'
    and (
      owner = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );

-- Reintento de una foto que quedó a medias: se pisa la misma ruta.
drop policy if exists "repartidor repisa su comprobante" on storage.objects;
create policy "repartidor repisa su comprobante"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'comprobantes' and owner = auth.uid())
  with check (bucket_id = 'comprobantes');
