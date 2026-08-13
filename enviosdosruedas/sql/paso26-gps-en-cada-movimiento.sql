-- ============================================================================
--  PASO 26 — Cada movimiento guarda dónde se hizo
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: la app pasa a mandar la posición junto con el
--  estado. Sin este paso el llamado falla con "Could not find the function".
--
--  QUÉ FALTABA. Las entregas guardan el GPS desde el primer día: la de las
--  13:21 de hoy quedó con dos metros de precisión. Los pasos intermedios no:
--  "retirado" y "en camino" se anotaban con la hora y nada más. Mirando el
--  historial de un día se ve dónde entregó y no dónde retiró, que es
--  justamente lo que hace falta cuando un comercio discute si el paquete se
--  pasó a buscar.
--
--  Ahora los cuatro movimientos guardan el punto, y el mapa del panel los usa
--  a todos para saber dónde anda cada uno.
--
--  Se agregan al final y con valor por defecto, así que la app vieja —la que
--  todavía tenga cargada un celular que no se actualizó— sigue funcionando
--  igual: manda el estado sin posición y el movimiento se guarda sin GPS,
--  como venía siendo.
-- ============================================================================

create or replace function public.set_shipment_status(
  p_shipment_id bigint,
  p_status      text,
  p_lat         double precision default null,
  p_lng         double precision default null,
  p_accuracy_m  double precision default null
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
    insert into public.delivery_logs (
      shipment_id, driver_id, event, happened_at,
      lat, lng, gps_accuracy
    )
    values (
      p_shipment_id, auth.uid(), p_status::public.delivery_event, now(),
      -- Coordenadas imposibles no se guardan: un GPS que devolvió cualquier
      -- cosa es peor que no tener punto, porque se le cree.
      case when abs(coalesce(p_lat, 999)) <= 90 then p_lat end,
      case when abs(coalesce(p_lng, 999)) <= 180 then p_lng end,
      p_accuracy_m
    );
  end if;

  return v_shipment;
end;
$$;

-- La firma vieja, de dos argumentos, se borra: si quedaran las dos, un llamado
-- con dos parámetros encajaría en ambas y Postgres cortaría con "could not
-- choose the best candidate function".
drop function if exists public.set_shipment_status(bigint, text);

revoke all on function public.set_shipment_status(
  bigint, text, double precision, double precision, double precision
) from public, anon;
grant execute on function public.set_shipment_status(
  bigint, text, double precision, double precision, double precision
) to authenticated;


-- ------------------------------------------------------------------ control
--
--  Una sola función, con cinco argumentos:
--
--    select p.oid::regprocedure from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'set_shipment_status';
--
--  Y en la calle: al tocar "ya lo retiré" y "salgo en camino", esos
--  movimientos tienen que quedar con GPS igual que las entregas.
--
--    select event, happened_at, lat, lng, gps_accuracy
--      from public.delivery_logs
--     order by happened_at desc limit 10;
