-- ============================================================================
--  PASO 28 — El desplegable de estado también deja historial
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: el panel pasa a llamar a esta función.
--
--  QUÉ PASABA. Cambiar el estado desde la columna del panel escribía la
--  casilla y nada más. Hoy 13/08 pasaste seis envíos a "retirado" a las 15:17
--  y quedaron sin hora de retiro y sin movimiento: el seguimiento del cliente
--  no muestra ese paso y el comprobante tampoco.
--
--  Los movimientos son lo que el cliente ve; la casilla es apenas cómo lo
--  guardamos nosotros. Cuando las dos cosas se separan, gana la que el cliente
--  no ve, y el seguimiento miente por omisión.
--
--  QUÉ ANOTA Y QUÉ NO:
--
--    retirado, en camino  → anota el movimiento. Son hechos: pasó algo en la
--                           calle y el cliente tiene derecho a verlo.
--    creado, pendiente    → no anota. Eso es corregir una casilla mal puesta,
--    de retiro              y un movimiento inventado sería peor que nada.
--    cancelado            → no anota, porque `delivery_event` no tiene ese
--                           valor. El estado se ve igual en el seguimiento.
--    entregado,           → los rechaza: van por "Cerrar", que pide quién
--    no entregado           recibió o el motivo, y deja la prueba.
--
--  El punto de GPS queda vacío a propósito: lo carga el panel desde una
--  computadora que puede estar a treinta cuadras. Un punto inventado es peor
--  que ninguno, porque después se le cree.
-- ============================================================================

create or replace function public.cambiar_estado_admin(
  p_shipment_id bigint,
  p_status      text
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
  -- Convertido una sola vez. Comparar el enum contra el texto directamente es
  -- lo que rompió el paso 26; no lo repitamos.
  v_nuevo    public.shipment_status := p_status::public.shipment_status;
  v_repetido integer;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  if p_status in ('entregado', 'pendiente_entrega') then
    raise exception 'USAR_CERRAR';
  end if;

  if p_status not in ('creado', 'pendiente_retiro', 'retirado', 'en_camino', 'cancelado') then
    raise exception 'ESTADO_NO_PERMITIDO: %', p_status;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  if v_shipment.status = v_nuevo then
    return v_shipment;
  end if;

  update public.shipments
     set status       = v_nuevo,
         -- Volver atrás también borra la hora de retiro: un envío que "todavía
         -- no se retiró" con hora de retiro puesta es un dato que miente.
         picked_up_at = case
                          when p_status = 'retirado' then coalesce(picked_up_at, now())
                          when p_status in ('creado', 'pendiente_retiro') then null
                          else picked_up_at
                        end
   where id = p_shipment_id
   returning * into v_shipment;

  if p_status in ('retirado', 'en_camino') then
    -- Si el repartidor acaba de anotarlo desde la app, no lo duplicamos. El
    -- de la app es mejor: viene con el punto de GPS.
    select count(*) into v_repetido
    from public.delivery_logs
    where shipment_id = p_shipment_id
      and event = p_status::public.delivery_event
      and happened_at > now() - interval '5 minutes';

    if v_repetido = 0 then
      insert into public.delivery_logs (shipment_id, driver_id, event, happened_at)
      values (
        p_shipment_id,
        -- El movimiento es del envío, y así lo leen el seguimiento, el mapa y
        -- el comprobante: por el repartidor que lo tiene. Si no tiene ninguno
        -- asignado, queda a nombre de quien lo cargó.
        coalesce(v_shipment.assigned_driver, auth.uid()),
        p_status::public.delivery_event,
        now()
      );
    end if;
  end if;

  return v_shipment;
end;
$$;

revoke all on function public.cambiar_estado_admin(bigint, text) from public, anon;
grant execute on function public.cambiar_estado_admin(bigint, text) to authenticated;


-- ---------------------------------------------------- la prueba de verdad
--
--  Recorre la función entera sobre un envío real y después se deshace sola: no
--  cambia ningún dato. Corrélo y mirá los avisos de abajo.

do $$
declare
  v_id     bigint;
  v_admin  uuid;
  v_estado public.shipment_status;
  v_res    public.shipments;
  v_logs   integer;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;

  select s.id, s.status into v_id, v_estado
    from public.shipments s
   where s.status in ('creado', 'pendiente_retiro', 'retirado')
   order by s.id desc
   limit 1;

  if v_id is null or v_admin is null then
    raise notice 'No hay con qué probar. Probalo desde el panel.';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  v_res := public.cambiar_estado_admin(
    v_id,
    case when v_estado = 'retirado' then 'en_camino' else 'retirado' end
  );

  select count(*) into v_logs
    from public.delivery_logs
   where shipment_id = v_id and happened_at > now() - interval '10 seconds';

  raise notice 'ANDA: el envío % pasó de % a %, con hora de retiro % y % movimiento(s) nuevo(s)',
    v_res.id, v_estado, v_res.status,
    coalesce(to_char(v_res.picked_up_at, 'HH24:MI'), 'vacía'), v_logs;

  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: no quedó ningún dato cambiado.';
    else
      raise notice 'FALLÓ: %', sqlerrm;
    end if;
end $$;
