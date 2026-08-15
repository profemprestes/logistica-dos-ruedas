-- ===========================================================================
-- Paso 33 · Decidir que un envío no entregado NO se reintenta
-- ===========================================================================
--
-- EL CASO. Un envío no se pudo entregar y queda en 'pendiente_entrega',
-- esperando que alguien decida. Casi siempre la decisión es reprogramarlo
-- (paso 31). Pero a veces el comercio nunca contesta, o contesta que ya no va:
-- el cliente se arrepintió, lo compró en otro lado, se mudó.
--
-- Hasta ahora esos envíos se quedaban ahí para siempre. Con el Panel del día
-- eso pasó a ser visible —salen en "NECESITA ATENCIÓN" todos los días— y por
-- eso hace falta la otra salida: decir "no se reintenta" y que quede escrito.
--
-- POR QUÉ NO ALCANZABA EL DESPLEGABLE DE ESTADOS. `cambiar_estado_admin` ya
-- deja poner 'cancelado', pero no deja rastro: el envío pasa a cancelado y
-- nadie sabe si fue porque el comercio lo pidió, porque se cargó mal, o por
-- error. Acá el motivo se guarda con el movimiento, que es donde alguien lo va
-- a ir a buscar dentro de tres meses cuando pregunten.
--
-- LA PLATA NO SE TOCA. El intento fallido ya quedó registrado con su fecha y
-- su motivo, y el resumen lo sigue mostrando: si el repartidor hizo el viaje,
-- ese viaje se paga o no se paga según lo que decidan, pero cancelar el envío
-- no lo borra. Ver REGLAS.
--
-- Se corre entero en el SQL Editor de Supabase. Al final hay una prueba que se
-- deshace sola.
-- ===========================================================================

create or replace function public.cancelar_sin_reprogramar(
  p_shipment_id bigint,
  p_motivo text default null
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  select * into v_shipment
    from public.shipments
   where id = p_shipment_id
     for update;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  -- Sólo desde "no entregado". Para el resto de los casos ya está el
  -- desplegable de estados: esta puerta es específicamente la de "se intentó,
  -- no se pudo, y no se va a volver a intentar".
  if v_shipment.status <> 'pendiente_entrega'::public.shipment_status then
    raise exception 'NO_ESTA_PARA_REPROGRAMAR';
  end if;

  -- Si ya nació el envío nuevo, la decisión está tomada al revés.
  if v_shipment.reprogramado_en is not null then
    raise exception 'YA_REPROGRAMADO';
  end if;

  update public.shipments
     set status = 'cancelado'::public.shipment_status
   where id = p_shipment_id
   returning * into v_shipment;

  /*
   * El movimiento queda a nombre de quien lo decidió, no del repartidor.
   *
   * Es al revés que en `cambiar_estado_admin`, y a propósito: retirar y salir
   * son cosas que hace el repartidor aunque las anote la oficina, pero decidir
   * que un envío no se reintenta es una decisión de la oficina. Además así no
   * se le mete un movimiento ajeno en la caja del día al repartidor.
   */
  insert into public.delivery_logs (shipment_id, driver_id, event, happened_at, comment)
  values (
    p_shipment_id,
    auth.uid(),
    'cancelado'::public.delivery_event,
    now(),
    coalesce(nullif(trim(p_motivo), ''), 'Se decidió no reprogramar el envío.')
  );

  return v_shipment;
end;
$$;

revoke all on function public.cancelar_sin_reprogramar(bigint, text) from public, anon;
grant execute on function public.cancelar_sin_reprogramar(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Prueba que se deshace sola
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin  uuid;
  v_id     bigint;
  v_antes  public.shipment_status;
  v_despues public.shipments;
  v_log    integer;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;

  select s.id, s.status into v_id, v_antes
    from public.shipments s
   order by s.id desc limit 1;

  if v_admin is null or v_id is null then
    raise notice 'No hay con qué probar.';
    return;
  end if;

  update public.shipments
     set status = 'pendiente_entrega', reprogramado_en = null
   where id = v_id;

  -- Sin esto la función corre como dueña de la base y `es_admin()` no prueba
  -- nada: hay que entrar como entra el panel.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);

  v_despues := public.cancelar_sin_reprogramar(v_id, 'El cliente no lo quiere más.');

  select count(*) into v_log
    from public.delivery_logs
   where shipment_id = v_id
     and event = 'cancelado'
     and comment = 'El cliente no lo quiere más.';

  raise notice 'ANDA:';
  raise notice '  el envío % quedó en % (tiene que ser cancelado)',
    v_despues.tracking_code, v_despues.status;
  raise notice '  quedó % movimiento con el motivo escrito (tiene que ser 1)', v_log;

  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: el envío quedó como estaba.';
    else
      raise notice 'FALLÓ: %', sqlerrm;
    end if;
end $$;
