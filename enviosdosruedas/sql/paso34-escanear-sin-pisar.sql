-- ===========================================================================
-- Paso 34 · Escanear dos veces el mismo paquete no lo pisa
-- ===========================================================================
--
-- Escanear de nuevo un envío que el repartidor YA tenía no era inofensivo:
--
--   1. `status` volvía a 'retirado'. Un envío que ya estaba EN CAMINO
--      retrocedía, y uno que había quedado NO ENTREGADO perdía ese estado y
--      aparecía como si nunca se hubiera intentado.
--   2. Quedaba otro movimiento 'retirado' en el historial. Al escribir esto
--      había tres envíos con el retiro duplicado.
--
-- Y apareció algo que no se veía: EL QR IMPRESO LLEVA EL ID INTERNO, y al
-- reprogramar (paso 31) nace un envío NUEVO, con otro id, que se queda con el
-- código. La etiqueta pegada en el paquete sigue teniendo el QR del intento
-- viejo, así que escanearla llevaba al envío archivado en vez de al vigente.
-- Ahora se sigue ese puntero: la etiqueta vuelve a servir, que era la idea.
--
-- Lo demás queda igual que estaba. Se corre entero en el SQL Editor de
-- Supabase; al final hay una prueba que se deshace sola.
-- ===========================================================================

create or replace function public.scan_and_assign(p_code text)
returns public.shipments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shipment  public.shipments;
  v_siguiente public.shipments;
  v_saltos    integer := 0;
  v_repetido  integer;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  select * into v_shipment
  from shipments
  where upper(trim(tracking_code)) = upper(trim(p_code))
     or id::text = trim(p_code)
  limit 1;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  /*
   * Del envío archivado al que está vigente.
   *
   * El tope de saltos no es por miedo a una cadena larga —el paso 32 no deja
   * reprogramar dos veces el mismo— sino para que un puntero mal cargado no
   * cuelgue la función para siempre.
   */
  while v_shipment.reprogramado_en is not null and v_saltos < 5 loop
    select * into v_siguiente from shipments where id = v_shipment.reprogramado_en;
    -- Si el reemplazo ya no está, vale el que teníamos: mejor un envío viejo
    -- que ninguno.
    exit when v_siguiente.id is null;
    v_shipment := v_siguiente;
    v_saltos := v_saltos + 1;
  end loop;

  if v_shipment.status in ('entregado', 'cancelado') then
    raise exception 'ENVIO_CERRADO';
  end if;

  if v_shipment.assigned_driver is not null
     and v_shipment.assigned_driver <> auth.uid() then
    raise exception 'ENVIO_YA_ASIGNADO_A_OTRO_REPARTIDOR';
  end if;

  -- Quedó no entregado y todavía nadie decidió qué hacer. Volver a retirarlo
  -- borraría ese intento: lo reprograma la oficina, no el escáner.
  if v_shipment.status = 'pendiente_entrega' then
    raise exception 'ENVIO_NO_ENTREGADO';
  end if;

  -- Ya lo tiene encima. No se toca nada: es el caso de escanear de nuevo por
  -- las dudas, o porque el paquete cambió de bolso.
  if v_shipment.assigned_driver = auth.uid()
     and v_shipment.status in ('retirado', 'en_camino') then
    raise exception 'YA_LO_TENES';
  end if;

  update shipments
     set assigned_driver = auth.uid(),
         assigned_at     = coalesce(assigned_at, now()),
         picked_up_at    = coalesce(picked_up_at, now()),
         status          = 'retirado'
   where id = v_shipment.id
   returning * into v_shipment;

  -- Un solo retiro por envío. Con el candado de arriba esto no debería llegar
  -- a hacer falta, pero el historial es lo que después se mira para discutir
  -- una entrega: que no dependa de un solo candado.
  select count(*) into v_repetido
  from delivery_logs
  where shipment_id = v_shipment.id
    and event = 'retirado';

  if v_repetido = 0 then
    insert into delivery_logs (shipment_id, driver_id, event, client_uuid)
    values (v_shipment.id, auth.uid(), 'retirado', gen_random_uuid());
  end if;

  return v_shipment;
end;
$function$;

revoke all on function public.scan_and_assign(text) from public, anon;
grant execute on function public.scan_and_assign(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Prueba que se deshace sola
-- ---------------------------------------------------------------------------
do $$
declare
  v_driver   uuid;
  v_id       bigint;
  v_uno      public.shipments;
  v_retiros  integer;
  v_error    text := '(no hubo)';
begin
  select s.id, s.assigned_driver into v_id, v_driver
    from public.shipments s
   where s.assigned_driver is not null
   order by s.id desc limit 1;

  if v_id is null then
    raise notice 'No hay con qué probar.';
    return;
  end if;

  update public.shipments
     set status = 'pendiente_retiro', picked_up_at = null, reprogramado_en = null
   where id = v_id;

  delete from public.delivery_logs where shipment_id = v_id and event = 'retirado';

  -- Entrar como entra la app del repartidor, si no `auth.uid()` es null.
  perform set_config('request.jwt.claims', json_build_object('sub', v_driver)::text, true);
  perform set_config('role', 'authenticated', true);

  -- Primer escaneo: tiene que tomarlo.
  v_uno := public.scan_and_assign(v_id::text);

  -- Segundo escaneo: tiene que rebotar.
  begin
    perform public.scan_and_assign(v_id::text);
  exception when others then
    v_error := sqlerrm;
  end;

  select count(*) into v_retiros
    from public.delivery_logs
   where shipment_id = v_id and event = 'retirado';

  raise notice 'ANDA:';
  raise notice '  el primer escaneo lo dejó en % (tiene que ser retirado)', v_uno.status;
  raise notice '  el segundo dijo "%" (tiene que ser YA_LO_TENES)', v_error;
  raise notice '  movimientos de retiro: % (tiene que ser 1)', v_retiros;

  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: el envío quedó como estaba.';
    else
      raise notice 'FALLÓ: %', sqlerrm;
    end if;
end $$;
