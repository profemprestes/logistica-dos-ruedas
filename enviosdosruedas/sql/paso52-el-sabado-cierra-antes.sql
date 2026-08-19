-- ============================================================================
--  PASO 52 — El horario de los sábados, que casi nunca es el de la semana
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  QUÉ ARREGLA. El comercio tiene UN horario de retiro, y con eso el panel
--  avisa cuando está por cerrar y todavía hay paquetes ahí. Pero un local que
--  de lunes a viernes cierra a las 18 el sábado cierra a las 13, y el aviso
--  salta a las 17 cuando el local está cerrado desde hace cuatro horas: llega
--  tarde justo el día que más falta hace.
--
--  ES OTRO CAMPO Y NO UN CALENDARIO. Se podría armar una tabla de horarios por
--  día de la semana, pero eso es una pantalla entera para cargar siete
--  renglones que en la práctica son dos: "los días de semana" y "los sábados".
--  El domingo no se reparte. Cuando aparezca un comercio que abre distinto los
--  martes, se verá; hoy sería inventar un problema.
--
--  VACÍO ES "IGUAL QUE SIEMPRE". Un comercio que no aclara nada sigue
--  funcionando exactamente como hasta ahora, y no hay que ir a cargarle nada a
--  los trece. El que cierra distinto el sábado se escribe, y listo.
--
--  ¿Y SI NO ABRE LOS SÁBADOS? Se escribe "cerrado" y alcanza: el texto no tiene
--  ninguna hora adentro, así que no se calcula ningún cierre y no salta ningún
--  aviso. Es el mismo criterio que ya rige para "por la mañana".
-- ============================================================================

alter table public.clients
  add column if not exists pickup_window_sabado text;

comment on column public.clients.pickup_window_sabado is
  'Horario de retiro de los sábados, cuando es distinto al de la semana. '
  'Vacío = usa el de siempre. Escribir "cerrado" si ese día no abre (paso 52).';


-- ------------------------------------------------- que lo pueda pedir el comercio
--
--  La tabla de pedidos del paso 51 guarda el estado final que quiere el
--  comercio, así que necesita este campo también: si no, el sábado es lo único
--  de su ficha que tendría que pedir por WhatsApp.

alter table public.solicitudes_comercio
  add column if not exists pickup_window_sabado text;


-- ---------------------------------- y que aprobar lo copie como todo lo demás
--
--  Misma función del paso 51 con un campo más. Se vuelve a crear entera porque
--  es más seguro leerla completa que adivinar qué le falta.

create or replace function public.aprobar_solicitud_comercio(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitudes_comercio;
begin
  if not public.es_admin() then
    raise exception 'Sólo la oficina puede aprobar un pedido';
  end if;

  select * into s from public.solicitudes_comercio where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'Ese pedido no existe o ya se resolvió';
  end if;

  update public.clients
     set phone                 = coalesce(nullif(btrim(s.phone), ''), phone),
         pickup_address        = coalesce(nullif(btrim(s.pickup_address), ''), pickup_address),
         pickup_extra          = coalesce(nullif(btrim(s.pickup_extra), ''), pickup_extra),
         pickup_notes          = coalesce(nullif(btrim(s.pickup_notes), ''), pickup_notes),
         pickup_window         = coalesce(nullif(btrim(s.pickup_window), ''), pickup_window),
         pickup_window_sabado  = coalesce(nullif(btrim(s.pickup_window_sabado), ''), pickup_window_sabado),
         /*
          * Si cambió la dirección, el punto del mapa deja de valer: la ficha
          * quedaría con la dirección nueva y el punto viejo, y el mapa mandaría
          * al repartidor a la cuadra de antes. Queda "sin ubicar", que se ve.
          */
         lat = case when nullif(btrim(s.pickup_address), '') is not null
                     and btrim(s.pickup_address) is distinct from btrim(coalesce(pickup_address, ''))
                    then null else lat end,
         lng = case when nullif(btrim(s.pickup_address), '') is not null
                     and btrim(s.pickup_address) is distinct from btrim(coalesce(pickup_address, ''))
                    then null else lng end
   where id = s.client_id;

  update public.solicitudes_comercio
     set estado = 'aprobada', resuelta_at = now(), resuelta_por = auth.uid()
   where id = p_id;
end;
$$;

grant execute on function public.aprobar_solicitud_comercio(bigint) to authenticated;


-- ---------------------------------------------------------------- comprobación
--
--  1. Que la columna esté en las dos tablas:
--
--     select table_name, column_name from information_schema.columns
--      where column_name = 'pickup_window_sabado';
--
--  2. Cargarle el sábado a un comercio y mirar cómo queda:
--
--     select name, pickup_window, pickup_window_sabado from public.clients
--      order by name;
