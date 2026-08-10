-- ============================================================================
--  PASO 5 — Arreglo de `resolve_delivery` contra el esquema real
--
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  QUÉ ESTABA MAL (tres errores encadenados, uno tapaba al otro):
--
--   1. `delivery_logs.event` es el enum `public.delivery_event`, no texto.
--      Meterle una variable `text` da:
--        "column event is of type delivery_event but expression is of type text"
--      Ese es el error que estás viendo.
--
--   2. `delivery_logs.failure_reason` TAMBIÉN es un enum, con valores
--      `ausente / intransitable / direccion_incorrecta / telefono_incorrecto /
--       rechazado / otro`. La app manda "Dirección incorrecta" (con mayúscula,
--      tilde y espacio). Era el error siguiente. Ahora se normaliza acá, así
--      las entregas que ya están en la cola del celular entran sin retocarlas.
--
--   3. En `shipments` la columna NO se llama `failure_reason` sino
--      `last_failure_reason`, y `status` es el enum `public.shipment_status`.
--      Era el tercer error.
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

  -- "Dirección incorrecta" -> "direccion_incorrecta". Lo que no reconozcamos
  -- cae en 'otro': mejor guardar el intento que perderlo por una tilde.
  v_reason := lower(trim(coalesce(p_reason, '')));
  v_reason := translate(v_reason, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  v_reason := replace(v_reason, ' ', '_');

  if v_reason not in ('ausente', 'intransitable', 'direccion_incorrecta',
                      'telefono_incorrecto', 'rechazado', 'otro') then
    v_reason := 'otro';
  end if;

  -- Plata que entra en la rendición: sólo la de la puerta y sólo si entregó.
  -- Lo de "cobrar al retirar" ya quedó registrado en su propio movimiento.
  if p_kind = 'entregado' and v_shipment.payment_mode = 'cobrar_destinatario' then
    v_cobra := coalesce(v_shipment.amount_to_collect, 0);
  end if;

  insert into public.delivery_logs (
    client_event_id, client_uuid, shipment_id, driver_id,
    event, failure_reason,
    receiver_name, receiver_dni, lat, lng, gps_accuracy, photo_path,
    amount_collected, happened_at, synced_offline
  )
  values (
    p_client_event_id, p_client_event_id, p_shipment_id, auth.uid(),
    p_kind::public.delivery_event,
    case when p_kind = 'no_entregado' then v_reason::public.failure_reason end,
    p_receiver_name, p_receiver_dni, p_lat, p_lng, p_accuracy_m, p_photo_path,
    v_cobra, p_happened_at, true
  )
  -- El índice único del paso 4 es parcial (`where client_event_id is not null`),
  -- así que hay que repetir esa condición acá o Postgres no lo reconoce y corta
  -- con "no unique or exclusion constraint matching the ON CONFLICT specification".
  on conflict (client_event_id) where client_event_id is not null do nothing;

  get diagnostics v_rows = row_count;

  -- Evento repetido (reintento de la cola): el estado ya se movió, no lo tocamos.
  if v_rows = 0 then
    return v_shipment;
  end if;

  update public.shipments
     set status = (case when p_kind = 'entregado' then 'entregado' else 'pendiente_entrega' end)
                  ::public.shipment_status,

         delivered_at = case when p_kind = 'entregado' then p_happened_at
                             else delivered_at end,

         last_failure_reason = case when p_kind = 'entregado' then last_failure_reason
                                    else v_reason::public.failure_reason end,

         -- Cada visita fallida suma un intento: sirve para saber cuándo dejar
         -- de insistir con una dirección.
         attempts = case when p_kind = 'entregado' then attempts
                         else coalesce(attempts, 0) + 1 end
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;

grant execute on function public.resolve_delivery(uuid, bigint, text, timestamptz, text, text, text, double precision, double precision, double precision, text) to authenticated;


-- ============================================================================
--  Nota: `accuracy_m` quedó de más
--
--  En el paso 4 agregué `delivery_logs.accuracy_m` sin ver que la tabla ya
--  tenía `gps_accuracy` para lo mismo. Esta función escribe en la de siempre
--  (`gps_accuracy`), así que la mía quedó sin uso. Si querés limpiarla:
--
--      alter table public.delivery_logs drop column if exists accuracy_m;
--
--  `client_event_id` sí se usa: es la clave única contra la que se apoya el
--  `on conflict` que evita cargar dos veces la misma entrega.
-- ============================================================================
