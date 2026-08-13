-- ============================================================================
--  PASO 31 — Reprogramar un envío que no se pudo entregar
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: el panel pasa a usar esta función.
--
--  QUÉ RESUELVE. Cuando una entrega falla, hoy el envío queda en "no
--  entregado" y para reintentarlo hay que moverle la fecha. El problema es que
--  al moverla, el envío se muda al día nuevo y el día en que el repartidor fue
--  hasta la puerta se queda sin nada: el viaje existió y no figura en ningún
--  lado.
--
--  Ahora se parte en dos. El intento fallido se queda quieto en SU día, con su
--  motivo y su historial, y nace un envío nuevo para la fecha nueva.
--
--  EL CÓDIGO SIGUE AL PAQUETE. El código es único en la base, así que dos
--  envíos no pueden tener el mismo. Lo que se hace es al revés de lo que uno
--  esperaría: el intento fallido se archiva como EDR...MDQ-1 y el envío NUEVO
--  se queda con el código original. Suena raro escrito, pero es lo que hace que
--  todo lo que ya está impreso o mandado siga sirviendo:
--
--    - la etiqueta pegada en el paquete —que sigue siendo el mismo paquete—
--      escanea bien y le abre al repartidor el envío de mañana;
--    - el link que le pasaste al cliente le muestra el intento de mañana, que
--      es lo que quiere saber;
--    - y el intento fallido no se pierde: queda con su código archivado.
--
--  El envío nuevo arranca en "retirado" cuando el paquete ya lo tenía el
--  repartidor, que es lo normal: nadie devuelve el paquete al comercio para
--  volver a buscarlo al otro día.
-- ============================================================================

-- De qué intento viene, para poder seguir la cadena.
alter table public.shipments
  add column if not exists reintento_de bigint references public.shipments(id) on delete set null;

comment on column public.shipments.reintento_de is
  'Si este envío nació de reprogramar otro que no se pudo entregar, cuál era.';

create index if not exists shipments_reintento_de_idx
  on public.shipments (reintento_de)
  where reintento_de is not null;


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

  -- Sólo se reprograma lo que no se pudo entregar. Un envío entregado no se
  -- reintenta, y uno en curso todavía no fracasó.
  if v_viejo.status <> 'pendiente_entrega'::public.shipment_status then
    raise exception 'NO_ESTA_PARA_REPROGRAMAR: %', v_viejo.status;
  end if;

  if p_fecha < public.fecha_local() then
    raise exception 'FECHA_PASADA';
  end if;

  -- El código base, sin el sufijo que pudiera tener de un intento anterior.
  v_base := regexp_replace(v_viejo.tracking_code, '-\d+$', '');

  -- El próximo número libre: el tercer intento archiva como -2, no pisa al -1.
  select coalesce(max((regexp_match(tracking_code, '-(\d+)$'))[1]::integer), 0) + 1
    into v_n
    from public.shipments
   where tracking_code like v_base || '-%';

  -- Primero se archiva el viejo: eso libera el código original para el nuevo.
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
    -- Si el paquete ya lo tenía el repartidor, sigue teniéndolo.
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

  -- El retiro se copia al historial del nuevo para que el seguimiento del
  -- cliente no arranque mudo: el paquete se retiró de verdad, ese día.
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
--  Reprograma un envío real COMO EL ADMIN y después se deshace: no queda nada.
--  Se cambia de rol a `authenticated` a propósito — corriendo como dueño de la
--  tabla los permisos ni se miran, y la prueba diría que anda siempre.

do $$
declare
  v_admin  uuid;
  v_id     bigint;
  v_codigo text;
  v_nuevo  public.shipments;
  v_viejo  public.shipments;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;
  select s.id, s.tracking_code into v_id, v_codigo
    from public.shipments s where s.picked_up_at is not null order by s.id desc limit 1;

  if v_admin is null or v_id is null then
    raise notice 'No hay con qué probar.';
    return;
  end if;

  -- Se lo pone en "no entregado" sólo dentro de esta prueba.
  update public.shipments set status = 'pendiente_entrega' where id = v_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);

  v_nuevo := public.reprogramar_envio(v_id, public.fecha_local() + 1);

  select * into v_viejo from public.shipments where id = v_id;

  raise notice 'ANDA:';
  raise notice '  el intento fallido quedó archivado como % (era %)', v_viejo.tracking_code, v_codigo;
  raise notice '  el envío nuevo #% se quedó con % , para el %, en estado %',
    v_nuevo.id, v_nuevo.tracking_code, v_nuevo.scheduled_date, v_nuevo.status;
  raise notice '  y viene del #% (intento número %)', v_nuevo.reintento_de, v_nuevo.attempts;

  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: no quedó ningún envío nuevo.';
    else
      raise notice 'FALLÓ: %', sqlerrm;
    end if;
end $$;
