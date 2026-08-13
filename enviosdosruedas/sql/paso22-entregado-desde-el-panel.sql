-- ============================================================================
--  PASO 22 — Marcar "entregado" desde el panel
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: el botón nuevo del panel llama a esta función.
--
--  EL PROBLEMA. El paso 21 dejó registrar el intento fallido desde el panel,
--  pero para el lado contrario seguía estando sólo el desplegable de estado, y
--  ese desplegable mueve una casilla sin escribir historial. Resultado: un
--  envío marcado "no entregado" y después corregido a entregado se quedaba
--  mostrando NO ENTREGADO en el seguimiento para siempre, porque el último
--  registro seguía siendo el intento fallido.
--
--  El sello del seguimiento ya se corrigió para que mande el estado del envío.
--  Esto es la otra mitad: que cerrar desde el panel deje el mismo rastro que
--  cerrar desde el celular, con fecha y con quién recibió.
--
--  QUÉ NO HACE. No inventa foto ni ubicación. Un cierre hecho desde el panel
--  es exactamente eso, y el comprobante lo va a mostrar sin foto: quien lo
--  mire tiene que poder distinguir una entrega con prueba de una cargada a
--  mano. Para eso está la app del repartidor.
-- ============================================================================

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

  if v_shipment.status = 'entregado' then
    raise exception 'ENVIO_YA_ENTREGADO';
  end if;

  -- Se le anota al repartidor que lo tenía asignado: es su entrega, y así
  -- cuenta en su resumen y en el cierre de caja. Sin repartidor, al que lo cargó.
  v_driver := coalesce(v_shipment.assigned_driver, auth.uid());

  -- La misma regla de plata que usa la app: sólo entra efectivo si el envío
  -- era a cobrar en la puerta. Si esto no coincidiera con `resolve_delivery`,
  -- la caja cerraría distinto según quién marcó la entrega.
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

revoke execute on function public.marcar_entregado(bigint, text, text) from public, anon;
grant execute on function public.marcar_entregado(bigint, text, text) to authenticated;


-- ------------------------------------------------------------------ control
--
--  1. Que exista una sola:
--
--     select p.oid::regprocedure from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public' and p.proname = 'marcar_entregado';
--
--  2. La prueba de verdad, con un envío que hayas marcado no entregado antes:
--     cerralo como entregado desde el panel y abrí su seguimiento. Tiene que
--     decir ENTREGADO con la fecha, y en el comprobante tienen que figurar los
--     DOS movimientos: el intento fallido y la entrega.
