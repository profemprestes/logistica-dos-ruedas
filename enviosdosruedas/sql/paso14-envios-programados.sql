-- ============================================================================
--  PASO 14 — Envíos programados para otro día
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  El campo `shipments.scheduled_date` ya existía y el panel ya te dejaba
--  elegir la fecha, pero no servía de nada: el repartidor veía todo junto y
--  podía cerrar hoy un envío que era para mañana.
--
--  A partir de acá, un envío con fecha futura se puede VER y nada más. No se
--  puede escanear, ni retirar, ni marcar en camino, ni entregar hasta que
--  llegue el día.
--
--  Va con triggers y no reescribiendo `scan_and_assign`, `set_shipment_status`
--  y `resolve_delivery` a propósito: si alguna de esas funciones se tocó
--  alguna vez directo en Supabase, volver a crearlas desde el repo pisaría ese
--  cambio sin avisar. El trigger se suma sin tocar lo que ya funciona.
-- ============================================================================


-- ------------------------------------------------------------- 1. qué día es
--
--  ¡OJO con la zona horaria! `current_date` en Postgres es UTC, y Argentina
--  está tres horas atrás. A las 21:00 del lunes acá, para UTC ya es martes:
--  con `current_date` los envíos de mañana se destrabarían tres horas antes,
--  la noche anterior. Por eso la fecha se calcula en hora argentina.
create or replace function public.fecha_local()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date;
$$;

grant execute on function public.fecha_local() to authenticated;


-- --------------------------------------------------- 2. ¿está programado?
create or replace function public.envio_programado(p_shipment_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.scheduled_date > public.fecha_local()
       from public.shipments s
      where s.id = p_shipment_id),
    false
  );
$$;

grant execute on function public.envio_programado(bigint) to authenticated;


-- ------------------------------------------- 3. candado al mover el estado
--
--  Cubre las tres puertas de una sola vez, porque las tres terminan acá:
--  `scan_and_assign` (pasa a en_camino), `set_shipment_status` (retirado /
--  en camino) y `resolve_delivery` (entregado / no entregado).
--
--  El admin queda exento: desde el panel tenés que poder corregir cualquier
--  cosa, incluso adelantar un envío que se cayó de la fecha.
create or replace function public.trg_bloquear_envio_programado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sólo molesta cuando el estado se mueve. Editar la dirección o reprogramar
  -- la fecha de un envío futuro tiene que seguir siendo posible.
  if new.status is not distinct from old.status then
    return new;
  end if;

  if public.es_admin() then
    return new;
  end if;

  if new.scheduled_date > public.fecha_local() then
    raise exception 'ENVIO_PROGRAMADO: % ', to_char(new.scheduled_date, 'DD/MM/YYYY');
  end if;

  return new;
end;
$$;

drop trigger if exists bloquear_envio_programado on public.shipments;
create trigger bloquear_envio_programado
  before update on public.shipments
  for each row
  execute function public.trg_bloquear_envio_programado();


-- ------------------------------------ 4. candado al guardar el comprobante
--
--  Segunda traba, y la más importante de las dos: la app del repartidor
--  funciona sin señal y manda las entregas después. Si sólo bloqueáramos el
--  cambio de estado, una entrega adelantada podría entrar igual por la cola.
create or replace function public.trg_bloquear_log_programado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.es_admin() then
    return new;
  end if;

  if public.envio_programado(new.shipment_id) then
    raise exception 'ENVIO_PROGRAMADO';
  end if;

  return new;
end;
$$;

drop trigger if exists bloquear_log_programado on public.delivery_logs;
create trigger bloquear_log_programado
  before insert on public.delivery_logs
  for each row
  execute function public.trg_bloquear_log_programado();


-- ============================================================================
--  Para probarlo: cargá un envío con fecha de mañana, asignáselo a un
--  repartidor y pedile que intente marcarlo retirado. Le tiene que aparecer
--  "Programado para el DD/MM: todavía no se puede tocar".
--
--  Ojo con una consecuencia: como el repartidor ya no puede escanear un envío
--  futuro, para que lo VEA en su lista tenés que asignárselo desde el panel.
--  Los que quedan "Libre (por escaneo)" no le aparecen hasta el día.
-- ============================================================================
