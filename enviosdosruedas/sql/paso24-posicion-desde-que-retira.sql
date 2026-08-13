-- ============================================================================
--  PASO 24 — El repartidor aparece en el mapa desde que retira
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  ESTE PASO ES OPCIONAL. Sin correrlo todo sigue funcionando igual; lo que
--  cambia es CUÁNDO se ve la moto en el mapa del panel.
--
--  EL PROBLEMA. El paso 20 guarda la posición solamente si el repartidor tiene
--  algún envío con estado "en camino". Suena bien pero en la calle deja un
--  hueco grande: retira ocho paquetes, arranca, y hasta que no toca "salgo en
--  camino" en alguno, el sistema no guarda nada. Está trabajando y en el mapa
--  no aparece. Por eso, mirando el panel, no se veía ninguna moto.
--
--  QUÉ CAMBIA. Ahora la posición se guarda mientras tenga paquetes en la mano:
--  retirado, en camino, o un intento fallido para reintentar. Los tres quieren
--  decir lo mismo — salió con mercadería y todavía no terminó.
--
--  QUÉ NO CAMBIA, y es lo que hace que esto siga siendo aceptable:
--
--   - Antes de retirar no se guarda nada. Un envío asignado para mañana, o uno
--     que todavía está en el comercio, no habilita a registrar dónde está
--     nadie: puede estar en su casa.
--   - Terminado el reparto se deja de guardar. Cerrado el último envío, no
--     queda registro de a qué hora volvió.
--   - Se sigue borrando sola a las tres horas.
--   - Afuera se sigue publicando aproximada, en una zona de 500 metros.
--
--  Si preferís que sea sólo con "en camino", no corras este paso.
-- ============================================================================

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
declare
  v_trabajando boolean;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  -- Coordenadas imposibles: casi siempre un GPS que devolvió cualquier cosa.
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return false;
  end if;

  -- ACÁ ESTÁ EL CAMBIO. Antes era sólo 'en_camino'.
  --
  -- Los tres estados quieren decir lo mismo: tiene paquetes encima y todavía no
  -- terminó. 'creado' y 'pendiente_retiro' quedan afuera a propósito: ahí el
  -- paquete sigue en el comercio y el repartidor puede estar en cualquier lado.
  select exists (
    select 1
      from public.shipments
     where assigned_driver = auth.uid()
       and status in ('retirado', 'en_camino', 'pendiente_entrega')
  ) into v_trabajando;

  if not v_trabajando then
    return false;
  end if;

  insert into public.driver_positions (driver_id, lat, lng, accuracy_m)
  values (auth.uid(), p_lat, p_lng, p_accuracy_m);

  /*
   * La limpieza ahora barre las viejas de TODOS y no sólo las de quien llama.
   *
   * Antes borraba `where driver_id = auth.uid()`, así que las posiciones de un
   * repartidor que dejaba de mandar quedaban ahí: el paso 20 promete "se borra
   * sola a las tres horas" y en los hechos era "se borra cuando vuelve a
   * mandar". Se vieron posiciones de once horas por eso.
   */
  delete from public.driver_positions
   where taken_at < now() - interval '3 hours';

  return true;
end;
$$;

revoke execute on function public.registrar_posicion(double precision, double precision, double precision)
  from public, anon;
grant execute on function public.registrar_posicion(double precision, double precision, double precision)
  to authenticated;


-- ------------------------------------------------------------------ control
--
--  Después de correrlo, esta consulta deja la tabla limpia de lo viejo que
--  haya quedado del comportamiento anterior:
--
--    delete from public.driver_positions where taken_at < now() - interval '3 hours';
--
--  Y la prueba de verdad: con un envío RETIRADO y la app abierta, tiene que
--  empezar a aparecer una fila cada dos minutos, y la moto en el mapa del
--  panel. Al cerrar el último envío del día, tienen que dejar de aparecer.
--
--    select taken_at, lat, lng from public.driver_positions order by id desc limit 10;
