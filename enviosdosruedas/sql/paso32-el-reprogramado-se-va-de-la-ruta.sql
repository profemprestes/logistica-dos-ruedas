-- ============================================================================
--  PASO 32 — El envío reprogramado se va de la hoja de ruta
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR.
--
--  QUÉ ME FALTÓ EN EL 31. Al reprogramar, el intento fallido queda en
--  "pendiente de entrega" —que para la app del repartidor es trabajo por
--  hacer—, así que le aparecían los dos: el de ayer y el de hoy. El mismo
--  paquete, dos veces, sin forma de saber cuál tocar.
--
--  El envío viejo sí tiene que seguir existiendo: es el registro del viaje que
--  hizo, y de eso se trataba el paso 31. Lo que no tiene que hacer es seguir
--  pidiendo trabajo.
--
--  Se resuelve con una marca: `reprogramado_en` dice a qué envío le pasó la
--  posta. Con eso la app puede sacarlo de la lista sin borrar nada ni inventarle
--  un estado que no existe.
--
--  Se podría haber mirado al revés —buscar si algún envío lo tiene como
--  `reintento_de`— pero eso obliga a la app del repartidor a hacer una segunda
--  consulta, y esa app trabaja sin señal la mitad del día. Una marca en la
--  misma fila viaja con ella al caché del celular.
-- ============================================================================

alter table public.shipments
  add column if not exists reprogramado_en bigint references public.shipments(id) on delete set null;

comment on column public.shipments.reprogramado_en is
  'Si este envío se reprogramó, cuál es el envío nuevo que lo reemplaza. Con esto puesto, deja de figurar como trabajo pendiente.';

create index if not exists shipments_reprogramado_en_idx
  on public.shipments (reprogramado_en)
  where reprogramado_en is not null;


-- Los que ya se reprogramaron antes de este paso: se les pone la marca ahora,
-- mirando quién los declaró como origen.
update public.shipments viejo
   set reprogramado_en = nuevo.id
  from public.shipments nuevo
 where nuevo.reintento_de = viejo.id
   and viejo.reprogramado_en is null;


-- La misma función del paso 31, con una línea más: al archivar el viejo,
-- también se le deja dicho quién lo reemplaza.
create or replace function public.reprogramar_envio(
  p_shipment_id bigint,
  p_fecha       date
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viejo  public.shipments;
  v_nuevo  public.shipments;
  v_base   text;
  v_n      integer;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  select * into v_viejo from public.shipments where id = p_shipment_id;

  if v_viejo.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  if v_viejo.status <> 'pendiente_entrega'::public.shipment_status then
    raise exception 'NO_ESTA_PARA_REPROGRAMAR: %', v_viejo.status;
  end if;

  -- Dos veces el mismo no: si ya se reprogramó, hay que trabajar sobre el
  -- envío nuevo, no volver a partir el viejo.
  if v_viejo.reprogramado_en is not null then
    raise exception 'YA_REPROGRAMADO: %', v_viejo.reprogramado_en;
  end if;

  if p_fecha < public.fecha_local() then
    raise exception 'FECHA_PASADA';
  end if;

  v_base := regexp_replace(v_viejo.tracking_code, '-\d+$', '');

  select coalesce(max((regexp_match(tracking_code, '-(\d+)$'))[1]::integer), 0) + 1
    into v_n
    from public.shipments
   where tracking_code like v_base || '-%';

  update public.shipments
     set tracking_code = v_base || '-' || v_n
   where id = v_viejo.id;

  insert into public.shipments (
    tracking_code, status, client_id, client_name_raw,
    pickup_address, pickup_notes,
    recipient_name, recipient_phone, address_street, address_extra, city,
    postal_code, lat, lng, notes, delivery_window, product_detail,
    payment_mode, shipping_fee, merchandise_amount, amount_to_collect,
    assigned_driver, assigned_at, scheduled_date, package_qty, weight_kg,
    attempts, is_flex, created_by, picked_up_at, reintento_de
  )
  values (
    v_base,
    case when v_viejo.picked_up_at is not null
         then 'retirado'::public.shipment_status
         else 'pendiente_retiro'::public.shipment_status end,
    v_viejo.client_id, v_viejo.client_name_raw,
    v_viejo.pickup_address, v_viejo.pickup_notes,
    v_viejo.recipient_name, v_viejo.recipient_phone, v_viejo.address_street,
    v_viejo.address_extra, v_viejo.city, v_viejo.postal_code,
    v_viejo.lat, v_viejo.lng, v_viejo.notes, v_viejo.delivery_window,
    v_viejo.product_detail, v_viejo.payment_mode, v_viejo.shipping_fee,
    v_viejo.merchandise_amount, v_viejo.amount_to_collect,
    v_viejo.assigned_driver, v_viejo.assigned_at, p_fecha,
    v_viejo.package_qty, v_viejo.weight_kg,
    coalesce(v_viejo.attempts, 0) + 1,
    v_viejo.is_flex, auth.uid(),
    v_viejo.picked_up_at,
    v_viejo.id
  )
  returning * into v_nuevo;

  -- Acá está lo nuevo: el viejo queda marcado y sale de la hoja de ruta.
  update public.shipments
     set reprogramado_en = v_nuevo.id
   where id = v_viejo.id;

  if v_nuevo.picked_up_at is not null then
    insert into public.delivery_logs (shipment_id, driver_id, event, happened_at)
    values (v_nuevo.id, v_nuevo.assigned_driver, 'retirado'::public.delivery_event,
            v_nuevo.picked_up_at);
  end if;

  return v_nuevo;
end;
$$;

revoke all on function public.reprogramar_envio(bigint, date) from public, anon;
grant execute on function public.reprogramar_envio(bigint, date) to authenticated;


-- ---------------------------------------------------- la prueba de verdad
--
--  Reprograma un envío real COMO EL ADMIN, comprueba que el viejo quede marcado
--  y que ya no cuente como trabajo pendiente, y después se deshace: no queda
--  nada. El cambio de rol es lo que hace que los permisos se apliquen de
--  verdad; corriendo como dueño de la tabla ni se miran.

do $$
declare
  v_admin   uuid;
  v_id      bigint;
  v_driver  uuid;
  v_nuevo   public.shipments;
  v_viejo   public.shipments;
  v_pendientes integer;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;

  select s.id, s.assigned_driver into v_id, v_driver
    from public.shipments s
   where s.picked_up_at is not null and s.assigned_driver is not null
   order by s.id desc limit 1;

  if v_admin is null or v_id is null then
    raise notice 'No hay con qué probar.';
    return;
  end if;

  update public.shipments set status = 'pendiente_entrega' where id = v_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);

  v_nuevo := public.reprogramar_envio(v_id, public.fecha_local() + 1);

  select * into v_viejo from public.shipments where id = v_id;

  -- Lo que ve la app del repartidor: sólo lo que no está reprogramado.
  select count(*) into v_pendientes
    from public.shipments
   where assigned_driver = v_driver
     and id in (v_id, v_nuevo.id)
     and reprogramado_en is null;

  raise notice 'ANDA:';
  raise notice '  el intento fallido quedó archivado como % y marcado como reemplazado por el #%',
    v_viejo.tracking_code, v_viejo.reprogramado_en;
  raise notice '  de los dos envíos, al repartidor le queda % (tiene que ser 1)', v_pendientes;

  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: no quedó ningún envío nuevo.';
    else
      raise notice 'FALLÓ: %', sqlerrm;
    end if;
end $$;
