-- ============================================================================
--  PASO 25 — La posición se guarda durante toda la jornada
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  REEMPLAZA AL PASO 24: si no lo corriste, saltealo y corré este. Si lo
--  corriste, este lo pisa y queda bien igual.
--
--  EL PROBLEMA. La regla venía siendo "sólo si tiene algo en camino", y casi
--  nunca se veía a nadie en el mapa. Retira ocho paquetes, arranca, y hasta
--  que no toca "salgo en camino" en alguno el sistema no guarda nada.
--
--  AHORA: mientras tenga trabajo del día sin terminar. O sea, desde que abre
--  la app con su hoja de ruta cargada hasta que cierra el último envío.
--
--  LO QUE SIGUE VALIENDO, que es lo que hace que esto no sea un rastreador:
--
--   - Sin trabajo de HOY sin terminar, no se guarda nada. Un domingo, o un día
--     sin envíos asignados, la app no registra dónde está aunque esté abierta.
--   - Cerrado el último envío del día se deja de guardar. No queda registro de
--     a qué hora volvió a su casa.
--   - Se borra sola a las tres horas.
--   - Afuera, en el seguimiento público, se sigue publicando aproximada: una
--     zona de 500 metros, nunca el punto exacto.
--
--  Lo que cambia respecto de antes es que ahora también se registra el rato
--  entre que abre la app y retira los paquetes. Es una decisión de la empresa,
--  no técnica: si preferís que empiece recién al retirar, cambiá la lista de
--  estados de abajo y sacá 'creado' y 'pendiente_retiro'.
--
--  OJO, Y ESTO NO LO ARREGLA NINGUNA REGLA: la app manda la posición sólo
--  mientras está EN PANTALLA. El navegador de un celular congela los
--  temporizadores de una pestaña que quedó atrás, y el repartidor se pasa el
--  día en Maps y en WhatsApp. Por eso se manda también en cada momento en que
--  la app vuelve al frente o se toca algo. Un rastreo continuo de verdad
--  necesita una app nativa, no una web.
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

  /*
   * ¿Tiene trabajo de hoy sin terminar?
   *
   * La fecha se compara con `fecha_local()` (paso 14) y no con `now()`: en UTC,
   * de noche ya estaríamos en el día siguiente y la jornada se cortaría sola a
   * las nueve de la noche.
   *
   * Se mira la fecha de reparto y no el estado nada más, porque un envío que
   * quedó pendiente de la semana pasada no puede habilitar a registrar dónde
   * está alguien hoy.
   */
  select exists (
    select 1
      from public.shipments
     where assigned_driver = auth.uid()
       and scheduled_date = public.fecha_local()
       and status not in ('entregado', 'cancelado')
  ) into v_trabajando;

  if not v_trabajando then
    return false;
  end if;

  insert into public.driver_positions (driver_id, lat, lng, accuracy_m)
  values (auth.uid(), p_lat, p_lng, p_accuracy_m);

  /*
   * La limpieza barre las viejas de TODOS y no sólo las de quien llama.
   *
   * Antes borraba `where driver_id = auth.uid()`, así que las de un repartidor
   * que dejaba de mandar quedaban ahí: el paso 20 promete "se borra sola a las
   * tres horas" y en los hechos era "se borra cuando vuelve a mandar". Se
   * vieron posiciones de once horas por eso.
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


-- Deja la tabla limpia de lo viejo que haya quedado del comportamiento anterior.
delete from public.driver_positions where taken_at < now() - interval '3 hours';


-- ------------------------------------------------------------------ control
--
--  Con un envío asignado para HOY y sin cerrar, y la app abierta en el
--  celular, tiene que empezar a aparecer una fila cada dos minutos:
--
--    select taken_at, lat, lng from public.driver_positions order by id desc limit 10;
--
--  Al cerrar el último envío del día, tienen que dejar de aparecer.
