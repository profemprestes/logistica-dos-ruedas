-- ============================================================================
--  PASO 38 — Preasignar un paquete sin dárselo todavía
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  EL PROBLEMA. Dos repartidores pueden ir al mismo comercio el mismo día, y
--  cada uno tiene que llevarse lo suyo. Hoy eso lo sostiene el WhatsApp y la
--  memoria: si Emiliano escanea un paquete que era de Agustín, el sistema se lo
--  da sin decir nada, y el error se descubre cuando Agustín llega y no está.
--
--  POR QUÉ NO ALCANZA CON ASIGNARLO. Asignar un envío lo mete en la hoja de
--  ruta del repartidor, y eso rompe justamente lo que hace bien el escaneo: el
--  repartidor se lleva lo que el comercio EFECTIVAMENTE le da, no lo que
--  figuraba cargado. Preasignar es más flojo a propósito — dice de quién es,
--  sin dárselo.
--
--  CÓMO QUEDA AL ESCANEAR:
--
--    preasignado a vos      →  se te asigna, como siempre
--    preasignado a otro     →  se rechaza, diciendo de quién es
--    sin preasignar         →  se lo lleva el que lo escanee
--
--  O sea que no preasignar sigue siendo válido, y es lo normal. Esto se usa el
--  día que dos van al mismo lugar.
--
--  EL COSTO, dicho de frente: si se preasigna a Emiliano y termina yendo
--  Agustín, Agustín no lo puede escanear. Se destraba desde el panel sacándole
--  el preasignado. Es un llamado más en el medio, y por eso conviene preasignar
--  sólo cuando hace falta.
-- ============================================================================

-- ------------------------------------------------------------- 1. la columna

alter table public.shipments
  add column if not exists preasignado_a uuid references public.profiles(id) on delete set null;

comment on column public.shipments.preasignado_a is
  'De quién es este paquete cuando lo retiren, sin asignárselo todavía. Sólo lo mira scan_and_assign (paso 38).';

-- Se consulta al escanear y al listar por repartidor en el panel.
create index if not exists shipments_preasignado_idx
  on public.shipments (preasignado_a)
  where preasignado_a is not null;


-- ------------------------------------------- 2. el escaneo lo tiene en cuenta
--
--  Reemplaza la función del paso 34. Lo único que se agrega es el bloque
--  marcado; todo lo demás queda igual, incluido seguir el puntero de los
--  reprogramados y la ventana de cinco minutos del retiro repetido.

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
  v_dueno     text;
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

  -- ---------------------------------------------------- lo nuevo del paso 38
  --
  --  Va DESPUÉS de la asignación de verdad: si el envío ya es suyo, que un
  --  preasignado viejo apunte a otro no puede quitárselo. Eso pasa cuando se
  --  preasigna, se escanea, y después alguien cambia el preasignado en el
  --  panel sin darse cuenta de que el paquete ya está en la moto.
  --
  --  El nombre viaja en el mensaje para que el repartidor sepa a quién
  --  devolvérselo, en vez de quedarse con un "no podés" que no explica nada.
  if v_shipment.preasignado_a is not null
     and v_shipment.preasignado_a <> auth.uid()
     and v_shipment.assigned_driver is null then
    select coalesce(full_name, 'otro repartidor') into v_dueno
      from public.profiles where id = v_shipment.preasignado_a;
    raise exception 'PREASIGNADO_A_OTRO: %', coalesce(v_dueno, 'otro repartidor');
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

  /*
   * Nada de retiros repetidos POR ACCIDENTE. Repetidos de verdad, sí. Si la
   * oficina devuelve un envío a 'pendiente_retiro' y después se retira otra
   * vez, ese segundo retiro PASÓ y el historial no puede mentir. La ventana es
   * la de siempre en este sistema: cinco minutos.
   */
  select count(*) into v_repetido
  from delivery_logs
  where shipment_id = v_shipment.id
    and event = 'retirado'
    and happened_at > now() - interval '5 minutes';

  if v_repetido = 0 then
    insert into delivery_logs (shipment_id, driver_id, event, client_uuid)
    values (v_shipment.id, auth.uid(), 'retirado', gen_random_uuid());
  end if;

  return v_shipment;
end;
$function$;

revoke all on function public.scan_and_assign(text) from public, anon;
grant execute on function public.scan_and_assign(text) to authenticated;


-- ---------------------------------------------------------------- 3. permiso
--
--  Preasignar lo hace el admin desde el panel, con su propia sesión. La
--  política de escritura de `shipments` ya distingue admin de repartidor, así
--  que no hay nada nuevo que abrir: la columna viaja con la fila.


-- ------------------------------------------------------------- prueba que se
--                                                                deshace sola
do $$
declare
  v_a       uuid;
  v_b       uuid;
  v_id      bigint;
  v_error   text := '(no hubo)';
  v_previo  uuid;
  v_estado  text;
begin
  select id into v_a from public.profiles where role = 'repartidor' order by created_at limit 1;
  select id into v_b from public.profiles where role = 'repartidor' and id <> v_a limit 1;

  if v_a is null or v_b is null then
    raise notice 'Hacen falta dos repartidores para probar esto. Se saltea.';
    return;
  end if;

  select id, preasignado_a, status into v_id, v_previo, v_estado
    from public.shipments order by id desc limit 1;

  update public.shipments
     set preasignado_a = v_b, assigned_driver = null, status = 'pendiente_retiro',
         picked_up_at = null, reprogramado_en = null
   where id = v_id;

  -- Entrar como el repartidor EQUIVOCADO.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    perform public.scan_and_assign(v_id::text);
  exception when others then
    v_error := sqlerrm;
  end;

  raise notice 'ANDA:';
  raise notice '  el que no era lo escaneó y dijo: "%"', v_error;
  raise notice '  (tiene que empezar con PREASIGNADO_A_OTRO y traer el nombre)';

  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: el envío quedó como estaba.';
    else
      raise notice 'FALLÓ: %', sqlerrm;
    end if;
end $$;


-- ------------------------------------------------------------------ control
--
--  1. Que la columna esté:
--
--     select column_name from information_schema.columns
--      where table_name = 'shipments' and column_name = 'preasignado_a';
--
--  2. Quién tiene paquetes preasignados sin retirar:
--
--     select p.full_name, count(*)
--       from public.shipments s join public.profiles p on p.id = s.preasignado_a
--      where s.assigned_driver is null and s.status not in ('entregado','cancelado')
--      group by 1;
--
--  3. La prueba de verdad, en la calle: preasignar un paquete a uno y que lo
--     escanee el otro. Tiene que rechazarlo diciendo de quién es.
