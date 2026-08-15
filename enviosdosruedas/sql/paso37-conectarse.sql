-- ============================================================================
--  PASO 37 — El repartidor se conecta y se desconecta
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa. Hay otro
--  proyecto viejo en la misma cuenta y ya nos comió una tarde.
--
--  QUÉ CAMBIA. Hasta ahora la posición se guardaba automáticamente, con una
--  sola regla: "mientras tenga trabajo del día sin cerrar". Eso tenía dos
--  problemas opuestos.
--
--  Para la oficina, dejaba ciego el caso más útil: el repartidor SIN envíos.
--  "¿Quién está más cerca de Güemes para este retiro?" no se puede contestar si
--  justamente los que están libres no aparecen en el mapa.
--
--  Para el repartidor, no había forma de decir "hoy no estoy trabajando". El
--  sistema decidía por él mirando si tenía envíos.
--
--  AHORA SE CONECTA A MANO, y eso resuelve las dos cosas. Se lo ve aunque no
--  tenga nada asignado, y es él quien decide cuándo empieza y cuándo termina.
--
--  Olvidarse de conectarse no rompe nada, porque la app no le muestra la hoja
--  de ruta hasta que se conecta: se da cuenta solo, en el primer segundo.
--
--  Y OLVIDARSE DE DESCONECTARSE TAMPOCO, que es lo que importa de verdad. La
--  conexión se vence sola a las dos horas sin actividad. Sin eso, el que se va
--  a su casa sin tocar el botón quedaría registrado todo el camino, y ahí el
--  sistema deja de saber dónde están sus repartidores mientras trabajan y pasa
--  a saber dónde viven. Esa línea no se cruza por comodidad.
--
--  Mientras tenga un envío del día sin cerrar NO se vence: está trabajando
--  aunque no toque nada durante dos horas, que pasa en un comercio que demora.
-- ============================================================================

-- ------------------------------------------------------------- 1. la columna
--
--  Null es "desconectado". La hora sirve para dos cosas: saber desde cuándo, y
--  contar las dos horas cuando todavía no hizo nada más.

alter table public.profiles
  add column if not exists conectado_desde timestamptz;

comment on column public.profiles.conectado_desde is
  'Cuándo se conectó el repartidor. Null = desconectado. Se vence sola a las 2 h sin actividad (paso 37).';


-- --------------------------------------------------- 2. cuánto dura sin tocar

create or replace function public.horas_de_gracia()
returns interval
language sql
immutable
as $$ select interval '2 hours' $$;

comment on function public.horas_de_gracia() is
  'Cuánto aguanta la conexión sin actividad. Está acá y no repetido en cada consulta para cambiarlo en un solo lugar.';


-- ------------------------------------------------- 3. ¿está conectado ahora?
--
--  Una sola función que contesta la pregunta, para que la app, el panel y
--  `registrar_posicion` no puedan contestarla distinto entre sí. Cuando la
--  misma regla vive en tres lugares, tarde o temprano dicen tres cosas.

create or replace function public.esta_conectado(p_driver uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desde     timestamptz;
  v_actividad timestamptz;
begin
  select conectado_desde into v_desde from public.profiles where id = p_driver;

  if v_desde is null then
    return false;
  end if;

  -- Con trabajo del día sin cerrar no se vence nunca: está laburando aunque no
  -- toque un botón en dos horas, que es exactamente lo que pasa esperando en un
  -- comercio.
  if exists (
    select 1 from public.shipments
     where assigned_driver = p_driver
       and scheduled_date = public.fecha_local()
       and status not in ('entregado', 'cancelado')
  ) then
    return true;
  end if;

  -- Si no, cuentan las dos horas desde lo último que hizo. Conectarse cuenta
  -- como actividad: si no, el que se conecta a las 9 sin nada asignado quedaría
  -- afuera desde el primer minuto, que es el caso que esto vino a cubrir.
  select max(happened_at) into v_actividad
    from public.delivery_logs
   where driver_id = p_driver
     and happened_at >= v_desde;

  return now() - greatest(v_desde, coalesce(v_actividad, v_desde)) < public.horas_de_gracia();
end;
$$;


-- ------------------------------------------------------ 4. los dos botones

create or replace function public.conectarse()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ahora timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  /*
   * Volver a conectarse estando conectado NO reinicia el reloj.
   *
   * Suena inofensivo y no lo es: la app pregunta el estado cada tanto, y si
   * cada consulta empujara la hora, la conexión no se vencería jamás. El
   * vencimiento de dos horas dejaría de existir sin que nadie lo note.
   */
  update public.profiles
     set conectado_desde = case
           when public.esta_conectado(id) then conectado_desde
           else v_ahora
         end
   where id = auth.uid()
   returning conectado_desde into v_ahora;

  return v_ahora;
end;
$$;

create or replace function public.desconectarse()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  update public.profiles set conectado_desde = null where id = auth.uid();
end;
$$;

revoke execute on function public.conectarse() from public, anon;
revoke execute on function public.desconectarse() from public, anon;
revoke execute on function public.esta_conectado(uuid) from public, anon;
grant execute on function public.conectarse() to authenticated;
grant execute on function public.desconectarse() to authenticated;
grant execute on function public.esta_conectado(uuid) to authenticated;


-- ------------------------------------- 5. la posición ahora mira la conexión
--
--  REEMPLAZA la regla del paso 25. Antes: "mientras tenga trabajo del día sin
--  cerrar". Ahora: "mientras esté conectado", y el vencimiento de dos horas
--  ocupa el lugar que tenía aquella regla como límite.
--
--  Lo demás del paso 25 no se toca y sigue siendo lo que hace que esto no sea
--  un rastreador: se borra sola a las tres horas, y afuera se publica
--  aproximada y con retraso.

create or replace function public.registrar_posicion(
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  -- Coordenadas imposibles: casi siempre un GPS que devolvió cualquier cosa.
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return false;
  end if;

  -- La regla, y vive acá y no en la app a propósito: si mañana alguien llama a
  -- esta función desde otro lado, la regla sigue valiendo.
  if not public.esta_conectado(auth.uid()) then
    return false;
  end if;

  insert into public.driver_positions (driver_id, lat, lng, accuracy_m)
  values (auth.uid(), p_lat, p_lng, p_accuracy_m);

  -- Se barren las viejas de TODOS y no sólo las de quien llama: las de alguien
  -- que dejó de mandar quedaban ahí para siempre (ver paso 25).
  delete from public.driver_positions
   where taken_at < now() - interval '3 hours';

  return true;
end;
$$;

revoke execute on function public.registrar_posicion(double precision, double precision, double precision)
  from public, anon;
grant execute on function public.registrar_posicion(double precision, double precision, double precision)
  to authenticated;


-- --------------------------------------------- 6. que el panel pueda mirarlo
--
--  No hace falta tocar los permisos: el admin ya lee `profiles` para sacar los
--  nombres del mapa, y `conectado_desde` viaja en la misma fila. Queda anotado
--  para que nadie salga a buscar la política que falta.
--
--  El mapa la usa para distinguir "desconectado" de "sin señal", que hasta
--  ahora se veían iguales siendo cosas opuestas: una es que terminó la jornada
--  y no hay nada que hacer, la otra es que está trabajando y le perdimos el
--  rastro.


-- ------------------------------------------------------------------ control
--
--  1. Que las funciones existan:
--
--     select p.oid::regprocedure from pg_proc p
--       join pg_namespace n on n.oid = p.pronamespace
--      where n.nspname = 'public'
--        and p.proname in ('conectarse','desconectarse','esta_conectado','horas_de_gracia');
--
--  2. Quién está conectado ahora mismo:
--
--     select full_name, conectado_desde, public.esta_conectado(id) as vale
--       from public.profiles where role = 'repartidor';
--
--  3. La prueba de verdad, en el celular: sin conectarse, la app no muestra la
--     hoja de ruta y NO tienen que entrar posiciones. Al conectarse, aparece la
--     ruta y empiezan a entrar. Al desconectarse, tienen que parar y el aviso
--     fijo de ubicación tiene que desaparecer.
