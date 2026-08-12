-- ============================================================================
--  PASO 16 — "Registrado sin señal" sólo cuando es cierto
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  BUG: `resolve_delivery` guardaba `synced_offline = true` FIJO, en toda
--  entrega. Venía así desde el paso 12 y el paso 15 lo arrastró. Resultado:
--  el cartel "Registrado sin señal" aparecía siempre, incluso en entregas
--  cerradas con señal perfecta. Un dato que miente en el 100% de los casos es
--  peor que no tenerlo, porque el día que de verdad importe nadie le va a
--  creer.
--
--  Cómo se decide ahora: no lo dice el celular, lo dice el reloj. Si la
--  entrega llega más de 2 minutos después de haber ocurrido, es que estuvo
--  esperando en la cola del teléfono. Con señal, el viaje es de segundos.
--
--  ¿Por qué no preguntarle al navegador si tenía internet? Porque
--  `navigator.onLine` miente: dice que sí con sólo estar prendido el WiFi,
--  aunque no haya salida. El reloj no miente.
--
--  Esta versión es la del paso 15 (con `p_comment`) y cambia UNA línea. Si
--  tocaste la función en Supabase, comparala antes de correr esto.
-- ============================================================================

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
  v_offline  boolean;
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

  -- ACÁ está el arreglo. Antes era `true` a secas.
  v_offline := p_happened_at < now() - interval '2 minutes';

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
    v_cobra, p_happened_at, v_offline
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


-- ------------------------------------------- arreglar lo que ya está cargado
--
--  Todas las entregas viejas quedaron marcadas como "sin señal". El dato para
--  corregirlas está en la misma fila: `created_at` es cuándo llegó al servidor
--  y `happened_at` cuándo pasó de verdad. Se les aplica el mismo criterio.
update public.delivery_logs
   set synced_offline = (happened_at < created_at - interval '2 minutes')
 where synced_offline is distinct from (happened_at < created_at - interval '2 minutes');
