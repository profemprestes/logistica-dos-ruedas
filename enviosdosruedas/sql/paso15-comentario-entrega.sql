-- ============================================================================
--  PASO 15 — El repartidor puede dejar un comentario al cerrar la entrega
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  La columna `delivery_logs.comment` ya existía y el comprobante ya la
--  mostraba, pero no había forma de llenarla: `resolve_delivery` no recibía el
--  dato. O sea, el campo estaba muerto.
--
--  Ahora se puede escribir "recibió el encargado del edificio", "dejado en
--  portería", "el vecino del 3B firmó" — que es lo que después salva una
--  discusión con el comercio.
--
--  ¡OJO! Esta vez SÍ se reescribe `resolve_delivery`. La versión de acá abajo
--  es la del paso 12 más el parámetro nuevo. Si alguna vez tocaste esa función
--  directo en Supabase y ese cambio no quedó en el repo, esto lo pisa. Antes de
--  correr, mirala en Supabase → Database → Functions y comparala con esta.
-- ============================================================================


-- Se borra la versión vieja antes de crear la nueva. Si dejáramos las dos,
-- Postgres no sabría cuál usar al llamarla con los 11 parámetros de antes
-- ("function is not unique") y la app del repartidor dejaría de cerrar entregas.
drop function if exists public.resolve_delivery(
  uuid, bigint, text, timestamptz, text, text, text,
  double precision, double precision, double precision, text
);

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
  p_photo_path      text             default null,
  p_comment         text             default null
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
  v_rows     integer;
  v_cobra    numeric := 0;
  v_reason   text;
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

  -- Un paquete que nunca se retiró no se puede haber entregado. Sin esto el
  -- seguimiento del cliente salta de "registrado" a "entregado" sin el medio.
  if v_shipment.status in ('creado', 'pendiente_retiro') then
    raise exception 'FALTA_RETIRAR';
  end if;

  -- Normaliza el motivo al enum: "Dirección incorrecta" -> direccion_incorrecta
  v_reason := lower(trim(coalesce(p_reason, '')));
  v_reason := translate(v_reason, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  v_reason := replace(v_reason, ' ', '_');

  if v_reason not in ('ausente', 'intransitable', 'direccion_incorrecta',
                      'telefono_incorrecto', 'rechazado', 'otro') then
    v_reason := 'otro';
  end if;

  if p_kind = 'entregado' and v_shipment.payment_mode = 'cobrar_destinatario' then
    v_cobra := coalesce(v_shipment.amount_to_collect, 0);
  end if;

  insert into public.delivery_logs (
    client_event_id, client_uuid, shipment_id, driver_id,
    event, failure_reason,
    receiver_name, receiver_dni, lat, lng, gps_accuracy, photo_path,
    comment,
    amount_collected, happened_at, synced_offline
  )
  values (
    p_client_event_id, p_client_event_id, p_shipment_id, auth.uid(),
    p_kind::public.delivery_event,
    case when p_kind = 'no_entregado' then v_reason::public.failure_reason end,
    p_receiver_name, p_receiver_dni, p_lat, p_lng, p_accuracy_m, p_photo_path,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_cobra, p_happened_at, true
  )
  on conflict (client_event_id) where client_event_id is not null do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return v_shipment;   -- evento repetido: el estado ya se movió
  end if;

  update public.shipments
     set status = (case when p_kind = 'entregado' then 'entregado' else 'pendiente_entrega' end)
                  ::public.shipment_status,

         delivered_at = case when p_kind = 'entregado' then p_happened_at
                             else delivered_at end,

         last_failure_reason = case when p_kind = 'entregado' then last_failure_reason
                                    else v_reason::public.failure_reason end,

         attempts = case when p_kind = 'entregado' then attempts
                         else coalesce(attempts, 0) + 1 end
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;

grant execute on function public.resolve_delivery(
  uuid, bigint, text, timestamptz, text, text, text,
  double precision, double precision, double precision, text, text
) to authenticated;
