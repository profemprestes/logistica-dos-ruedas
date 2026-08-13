-- ============================================================================
--  PASO 21 — Marcar "no entregado" desde el panel
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: el botón nuevo del panel llama a esta función.
--  Sin ella, tira "Could not find the function".
--
--  EL AGUJERO QUE TAPA. Desde el panel se podía cambiar el estado del envío a
--  "pendiente de entrega", pero eso mueve una casilla y nada más: NO deja
--  registro del intento fallido. Y el seguimiento del cliente se guía por el
--  registro, no por el estado. Resultado: el envío quedaba mostrando
--  "PENDIENTE DE ENTREGA" y no "NO ENTREGADO", sin motivo ni fecha, y en el
--  comprobante de entrega no figuraba el intento.
--
--  Pasa seguido: el repartidor avisa por teléfono que no pudo entregar, o
--  cierra mal, o se queda sin batería. Alguien tiene que poder dejarlo
--  asentado desde el panel.
--
--  POR QUÉ UNA FUNCIÓN Y NO ESCRIBIR LA TABLA DIRECTO. `delivery_logs` sólo
--  tiene permiso de LECTURA: nadie escribe ahí a mano, ni el repartidor. Las
--  entregas entran por `resolve_delivery` y ahora los intentos fallidos del
--  panel entran por acá. Que la única forma de escribir sea una función es lo
--  que garantiza que el estado del envío y su historial no se separen nunca.
-- ============================================================================

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

  if v_shipment.status in ('entregado', 'cancelado') then
    raise exception 'ENVIO_YA_CERRADO';
  end if;

  -- El movimiento se le anota al repartidor que lo tenía asignado: es su
  -- intento, y así aparece en su resumen y en el cierre de caja. Si el envío
  -- no tiene repartidor, queda a nombre de quien lo cargó.
  v_driver := coalesce(v_shipment.assigned_driver, auth.uid());

  -- Mismo normalizado que usa la app del repartidor: "Dirección incorrecta"
  -- entra como direccion_incorrecta.
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
         attempts = coalesce(attempts, 0) + 1
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;

revoke execute on function public.marcar_no_entregado(bigint, text, text) from public, anon;
grant execute on function public.marcar_no_entregado(bigint, text, text) to authenticated;


-- ------------------------------------------------------------------ control
--
--  1. Que exista una sola:
--
--     select p.oid::regprocedure from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'marcar_no_entregado';
--
--  2. La prueba de verdad: marcá un envío como no entregado desde el panel y
--     abrí su seguimiento. Tiene que decir NO ENTREGADO con el motivo, y el
--     intento tiene que aparecer en el comprobante de entrega.
--
--  OJO: un envío cargado para otro día no se puede cerrar, ni desde acá ni
--  desde el celular. Lo frena el disparador del paso 14, que es lo correcto:
--  todavía no le tocaba. Si de verdad hay que cerrarlo, primero se le cambia
--  la fecha de reparto.
