-- ============================================================================
--  PASO 4 — Arreglo del bug "esperando señal" + ajuste manual en la liquidación
--
--  Escrito contra el esquema REAL de tu base (verificado el 09/08/2026):
--    · delivery_logs  EXISTE   (id, shipment_id, driver_id, event, amount_collected,
--                               happened_at, failure_reason, receiver_name,
--                               receiver_dni, lat, lng, photo_path, created_at)
--    · delivery_events NO existe (se ve que la reemplazaron por delivery_logs)
--    · scan_and_assign EXISTE y es una versión nueva -> NO se toca acá
--    · resolve_delivery NO EXISTE  <- esta es la causa del bug
--
--  Se puede correr más de una vez.
-- ============================================================================


-- ------------------------------------------------- 1. ajuste manual del cierre
-- Lo que el repartidor rindió DE VERDAD, que puede no coincidir con la cuenta
-- del sistema (gastó en nafta, quedó debiendo, redondeos).
alter table public.settlements
  add column if not exists actual_amount numeric(12, 2);

comment on column public.settlements.actual_amount is
  'Monto real rendido, cargado a mano por el admin. Si es null, se asume cash_total.';


-- --------------------------------------------- 2. idempotencia de la cola offline
-- El celular arma este UUID ANTES de tener señal. Sin esta columna, un reintento
-- de la cola cargaría la misma entrega dos veces.
alter table public.delivery_logs
  add column if not exists client_event_id uuid,
  add column if not exists accuracy_m      double precision;

create unique index if not exists delivery_logs_client_event_idx
  on public.delivery_logs (client_event_id)
  where client_event_id is not null;


-- ============================================================================
--  3. LA FUNCIÓN QUE FALTABA
--
--  La app del repartidor viene llamando a `resolve_delivery` desde el paso 3,
--  pero en la base no existe: PostgREST contesta PGRST202 ("could not find the
--  function"). Como la app trataba CUALQUIER error como falta de señal, la
--  entrega quedaba en la cola para siempre y mostraba "esperando señal" aun
--  con wifi. Ese es el bug, completo.
--
--  Crearla es seguro: no hay nada que pisar.
-- ============================================================================
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
  v_cobra    numeric := 0;
  v_rows     integer;   -- integer, NO boolean: row_count devuelve bigint
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  if p_kind not in ('entregado', 'no_entregado') then
    raise exception 'TIPO_INVALIDO: %', p_kind;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  if v_shipment.assigned_driver is distinct from auth.uid() then
    raise exception 'ENVIO_DE_OTRO';
  end if;

  -- Plata que entra en la rendición: sólo la que se cobra en la puerta y sólo
  -- si el envío realmente se entregó. Lo de "cobrar al retirar" ya se registró
  -- en su propio movimiento cuando retiró el paquete.
  if p_kind = 'entregado' and v_shipment.payment_mode = 'cobrar_destinatario' then
    v_cobra := coalesce(v_shipment.amount_to_collect, 0);
  end if;

  insert into public.delivery_logs (
    client_event_id, shipment_id, driver_id, event, failure_reason,
    receiver_name, receiver_dni, lat, lng, accuracy_m, photo_path,
    amount_collected, happened_at
  )
  values (
    p_client_event_id, p_shipment_id, auth.uid(), p_kind,
    case when p_kind = 'entregado' then null else p_reason end,
    p_receiver_name, p_receiver_dni, p_lat, p_lng, p_accuracy_m, p_photo_path,
    v_cobra, p_happened_at
  )
  on conflict (client_event_id) do nothing;

  get diagnostics v_rows = row_count;

  -- Evento repetido (reintento de la cola): el estado ya se movió, no lo tocamos.
  if v_rows = 0 then
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


-- --------------------------------------- 4. que el chofer vea su propio resumen
-- /driver/profile calcula el "tenés que rendir" con la MISMA tabla que usa el
-- admin para liquidar, así los dos números no pueden discrepar.
drop policy if exists "repartidor ve sus movimientos" on public.delivery_logs;
create policy "repartidor ve sus movimientos"
  on public.delivery_logs for select
  to authenticated
  using (
    driver_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );


-- --------------------------------------------------- 5. fotos del comprobante
-- El bucket `delivery-photos` es privado (verificado: es el único que existe,
-- `comprobantes` del paso 3 nunca se creó). El repartidor tiene que poder subir
-- su foto y el admin poder verla desde la prueba de entrega.
--
-- Los `drop` de abajo también limpian las políticas del paso 3, que apuntaban a
-- un bucket inexistente y quedaron muertas.

drop policy if exists "repartidor sube comprobantes" on storage.objects;
create policy "repartidor sube comprobantes"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'delivery-photos');

-- Reintento de una foto que quedó a medias: se pisa la misma ruta (upsert).
drop policy if exists "repartidor repisa su comprobante" on storage.objects;
create policy "repartidor repisa su comprobante"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'delivery-photos' and owner = auth.uid())
  with check (bucket_id = 'delivery-photos');

drop policy if exists "comprobantes: ve el que subió y el admin" on storage.objects;
create policy "comprobantes: ve el que subió y el admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'delivery-photos'
    and (
      owner = auth.uid()
      or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    )
  );


-- ============================================================================
--  NOTA sobre "Cobrado al retirar"
--
--  Tu `scan_and_assign` ya registra el retiro en delivery_logs, pero deja
--  `amount_collected` en null. La app ahora deduce ese monto del envío cuando
--  el modo es 'cobrar_al_retirar' (ver `logCash` en lib/settlement.ts), así que
--  NO hace falta tocar tu función y las rendiciones viejas también se corrigen
--  solas.
--
--  Si algún día querés que el monto quede congelado en el movimiento (por si
--  cambia la tarifa del envío después del retiro), agregale a esa función:
--
--      amount_collected = case when v_shipment.payment_mode = 'cobrar_al_retirar'
--                              then coalesce(v_shipment.shipping_fee, 0) else 0 end
-- ============================================================================
