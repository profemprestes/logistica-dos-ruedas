-- ============================================================================
--  PASO 27 — Arreglo urgente: no se puede marcar "retirado"
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO YA. Desde el paso 26, marcar un envío como retirado o en camino
--  falla con:
--
--      operator does not exist: shipment_status = text
--
--  QUÉ PASÓ. La columna `status` es un enum (`shipment_status`) y el parámetro
--  que manda la app es texto. Postgres no los compara solos. El paso 12 ya
--  había arreglado esto mismo, comparando contra una variable ya convertida;
--  al reescribir la función entera para agregarle el GPS, la comparación
--  volvió a quedar directa y el arreglo se perdió.
--
--  Es la misma función del paso 26 —el GPS de cada movimiento queda igual—
--  con la conversión de vuelta en su lugar.
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
  -- La conversión se hace UNA VEZ, acá arriba, y después se usa siempre ésta.
  -- Comparar `v_shipment.status = p_status` es lo que rompió el paso 26.
  v_nuevo    public.shipment_status := p_status::public.shipment_status;
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
  if v_shipment.status = v_nuevo then
    return v_shipment;
  end if;

  update public.shipments
     set status       = v_nuevo,
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

revoke all on function public.set_shipment_status(
  bigint, text, double precision, double precision, double precision
) from public, anon;
grant execute on function public.set_shipment_status(
  bigint, text, double precision, double precision, double precision
) to authenticated;


-- ---------------------------------------------------- la prueba de verdad
--
--  Esto ejecuta la función COMO SI FUERA EL REPARTIDOR, sobre un envío real, y
--  después deshace todo. No cambia ningún dato: el bloque termina a propósito
--  con un error para que Postgres tire atrás el cambio de estado y el
--  movimiento que se insertó.
--
--  Lo importante es que recorre el camino completo hasta el final, que es lo
--  que la comprobación del paso 26 NO hizo: probé que la función existiera,
--  no que funcionara, y el error estaba adentro.
--
--  Corrélo y mirá los avisos (pestaña "Messages" o el panel de abajo).

do $$
declare
  v_id      bigint;
  v_driver  uuid;
  v_estado  public.shipment_status;
  v_res     public.shipments;
begin
  -- Un envío cualquiera que un repartidor podría tocar ahora mismo.
  select s.id, s.assigned_driver, s.status
    into v_id, v_driver, v_estado
    from public.shipments s
   where s.assigned_driver is not null
     and s.status in ('creado', 'pendiente_retiro', 'retirado')
     and coalesce(s.scheduled_date, public.fecha_local()) <= public.fecha_local()
   order by s.id desc
   limit 1;

  if v_id is null then
    raise notice 'No hay ningún envío asignado para probar. Probalo en la calle.';
    return;
  end if;

  -- Nos hacemos pasar por ese repartidor, sólo durante esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', v_driver)::text, true);

  v_res := public.set_shipment_status(
    v_id,
    case when v_estado = 'retirado' then 'en_camino' else 'retirado' end,
    -38.0055, -57.5426, 12
  );

  raise notice 'ANDA: el envío % pasó de % a %', v_res.id, v_estado, v_res.status;
  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: no quedó ningún dato cambiado.';
    else
      raise notice 'SIGUE FALLANDO: %', sqlerrm;
    end if;
end $$;
