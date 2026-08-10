-- ============================================================================
--  PASO 11 — El repartidor marca retirado / en camino
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  Hasta ahora el único que movía el estado era `scan_and_assign` (al escanear)
--  y `resolve_delivery` (al cerrar). Los envíos asignados a mano quedaban en
--  "pendiente de retiro" hasta que se entregaban, y el seguimiento público no
--  mostraba nada en el medio.
--
--  Esta función deja que el repartidor marque los dos pasos intermedios, y de
--  paso los registra en `delivery_logs` para que el cliente los vea.
-- ============================================================================

create or replace function public.set_shipment_status(
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
  v_repetido integer;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  -- Sólo los pasos intermedios: entregar y no entregar tienen su propia
  -- función, que además exige comprobante.
  if p_status not in ('retirado', 'en_camino') then
    raise exception 'ESTADO_NO_PERMITIDO: %', p_status;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  if v_shipment.assigned_driver is distinct from auth.uid() then
    raise exception 'ENVIO_DE_OTRO';
  end if;

  if v_shipment.status in ('entregado', 'cancelado') then
    raise exception 'ENVIO_YA_CERRADO';
  end if;

  -- Si ya estaba en ese estado no se hace nada: evita repetir el movimiento
  -- cuando alguien toca el botón dos veces.
  if v_shipment.status = p_status then
    return v_shipment;
  end if;

  update public.shipments
     set status       = p_status::public.shipment_status,
         picked_up_at = case
                          when p_status = 'retirado' then coalesce(picked_up_at, now())
                          else picked_up_at
                        end
   where id = p_shipment_id
   returning * into v_shipment;

  -- `scan_and_assign` ya deja su propio movimiento de retiro. Para no duplicarlo
  -- cuando el escaneo y este llamado ocurren casi juntos, se mira si hay uno
  -- igual muy reciente.
  select count(*) into v_repetido
  from public.delivery_logs
  where shipment_id = p_shipment_id
    and event = p_status::public.delivery_event
    and happened_at > now() - interval '5 minutes';

  if v_repetido = 0 then
    insert into public.delivery_logs (shipment_id, driver_id, event, happened_at)
    values (p_shipment_id, auth.uid(), p_status::public.delivery_event, now());
  end if;

  return v_shipment;
end;
$$;

revoke all on function public.set_shipment_status(bigint, text) from public;
grant execute on function public.set_shipment_status(bigint, text) to authenticated;
