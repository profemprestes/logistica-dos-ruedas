-- ============================================================================
--  PASO 23 — Poder corregir un cierre mal hecho
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR.
--
--  EL PROBLEMA, CON UN CASO REAL. El envío EDR00001046MDQ quedó con estado
--  "entregado" y un único movimiento: "no entregado". Se marcó no entregado,
--  después se corrigió a entregado con el desplegable —que mueve la casilla
--  pero no escribe historial— y al querer registrarlo bien con "Cerrar", la
--  función lo rechazaba con "ese envío ya está entregado o cancelado".
--
--  Las dos funciones de los pasos 21 y 22 miraban el ESTADO para decidir si
--  dejaban trabajar. Está mal: el estado es una casilla que cualquiera puede
--  mover, y lo que hay que evitar no es "tocar un envío cerrado" sino ANOTAR
--  DOS VECES LA MISMA ENTREGA.
--
--  Y hay un caso de la calle que las guardas viejas hacían imposible: el
--  repartidor marca "no entregado", vuelve a pasar más tarde y entrega. O al
--  revés, cierra una entrega por error y hay que dar marcha atrás. Las dos
--  cosas pasan seguido y el sistema tiene que dejar corregir.
--
--  Ahora la única regla es esa: no se anota dos veces la misma entrega. Todo
--  lo demás -corregir, dar marcha atrás, cerrar un envío que quedó a medias-
--  se puede.
-- ============================================================================

-- ------------------------------------------------- entregado, con un solo tope

create or replace function public.marcar_entregado(
  p_shipment_id   bigint,
  p_receiver_name text default null,
  p_comment       text default null
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
  v_driver   uuid;
  v_cobra    numeric := 0;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  -- El único tope: que la entrega no quede anotada dos veces. Se mira el
  -- HISTORIAL y no el estado, porque el estado se puede haber movido a mano
  -- sin que exista ningún registro — que es justo el caso que había que
  -- arreglar.
  if exists (
    select 1 from public.delivery_logs
     where shipment_id = p_shipment_id
       and event = 'entregado'
  ) then
    raise exception 'ENTREGA_YA_REGISTRADA';
  end if;

  v_driver := coalesce(v_shipment.assigned_driver, auth.uid());

  -- La misma regla de plata que usa la app del repartidor: si esto no
  -- coincidiera con `resolve_delivery`, la caja cerraría distinto según quién
  -- marcó la entrega.
  if v_shipment.payment_mode = 'cobrar_destinatario' then
    v_cobra := coalesce(v_shipment.amount_to_collect, 0);
  end if;

  insert into public.delivery_logs (
    client_event_id, client_uuid, shipment_id, driver_id,
    event, receiver_name, comment,
    amount_collected, happened_at, synced_offline
  )
  values (
    gen_random_uuid(), gen_random_uuid(), p_shipment_id, v_driver,
    'entregado'::public.delivery_event,
    nullif(trim(coalesce(p_receiver_name, '')), ''),
    nullif(trim(coalesce(p_comment, '')), ''),
    v_cobra, now(), false
  );

  update public.shipments
     set status = 'entregado'::public.shipment_status,
         delivered_at = now()
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;


-- ------------------------------------------- no entregado, siempre corregible

create or replace function public.marcar_no_entregado(
  p_shipment_id bigint,
  p_reason      text,
  p_comment     text default null
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
  v_reason   text;
  v_driver   uuid;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  -- Sin tope de estado. Anotar un intento fallido sobre un envío que figura
  -- entregado es exactamente lo que hace falta cuando se cerró por error, y
  -- eso vuelve a dejarlo pendiente para reintentarlo.

  v_driver := coalesce(v_shipment.assigned_driver, auth.uid());

  v_reason := lower(trim(coalesce(p_reason, '')));
  v_reason := translate(v_reason, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  v_reason := replace(v_reason, ' ', '_');

  if v_reason not in ('ausente', 'intransitable', 'direccion_incorrecta',
                      'telefono_incorrecto', 'rechazado', 'otro') then
    v_reason := 'otro';
  end if;

  insert into public.delivery_logs (
    client_event_id, client_uuid, shipment_id, driver_id,
    event, failure_reason, comment,
    amount_collected, happened_at, synced_offline
  )
  values (
    gen_random_uuid(), gen_random_uuid(), p_shipment_id, v_driver,
    'no_entregado'::public.delivery_event,
    v_reason::public.failure_reason,
    nullif(trim(coalesce(p_comment, '')), ''),
    0, now(), false
  );

  update public.shipments
     set status = 'pendiente_entrega'::public.shipment_status,
         last_failure_reason = v_reason::public.failure_reason,
         attempts = coalesce(attempts, 0) + 1,
         -- Si se está corrigiendo un "entregado" puesto por error, la fecha de
         -- entrega tiene que irse con él. Si no, el envío queda diciendo que
         -- no se entregó y con la hora en que se entregó.
         delivered_at = null
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;


revoke execute on function public.marcar_entregado(bigint, text, text) from public, anon;
grant  execute on function public.marcar_entregado(bigint, text, text) to authenticated;
revoke execute on function public.marcar_no_entregado(bigint, text, text) from public, anon;
grant  execute on function public.marcar_no_entregado(bigint, text, text) to authenticated;


-- ------------------------------------------------------------------ control
--
--  El caso que hay que poder hacer, de punta a punta, desde el panel:
--
--    1. Cerrar un envío como NO ENTREGADO  -> queda pendiente, con el motivo.
--    2. Cerrarlo despues como ENTREGADO    -> tiene que dejarlo entregado, y
--       en el comprobante tienen que figurar LOS DOS movimientos.
--    3. Volver a cerrarlo como ENTREGADO   -> ahora si tiene que rechazarlo:
--       "la entrega de ese envio ya esta registrada".
--
--  Y el de marcha atras: un envio entregado se puede marcar no entregado, y
--  vuelve a quedar pendiente sin fecha de entrega.
