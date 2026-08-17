-- ============================================================================
--  PASO 44 — Los paquetes libres NO se le muestran al repartidor
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  DESHACE UNA PARTE DEL PASO 43, Y ESTABA MAL PENSADA (por mí).
--
--  En el 43 los envíos sin preasignar salían en un grupo aparte, con la idea de
--  que el repartidor no tuviera que preguntar en el mostrador. Pero un paquete
--  sin dueño no es un paquete disponible: es uno que en la oficina TODAVÍA NO
--  SE REPARTIÓ. El local puede tenerlo listo y pasarlo en el momento, y ahí se
--  consulta y se asigna a quien corresponde.
--
--  Mostrárselo lo invita a llevárselo antes de que eso pase. Y como el escáner
--  deja tomar cualquier envío sin dueño —y tiene que seguir así— el sistema no
--  lo frenaría: se lo lleva y recién se sabe después.
--
--  Así que vuelve a ser lo que era: SÓLO LOS PREASIGNADOS A ÉL. Lo libre sigue
--  libre, y lo decide la oficina.
--
--  SE MANTIENE lo otro que trajo el 43: los envíos cargados para otro día no
--  aparecen. Ésos no los puede ni escanear (paso 14), así que listarlos sería
--  mandarlo a buscar algo que el sistema no le va a dejar tomar.
--
--  La columna `mio` se queda aunque ahora siempre venga en true. Sacarla
--  obligaría a borrar y crear la función de nuevo, y no gana nada.
-- ============================================================================

create or replace function public.paquetes_de_colecta(p_direccion text)
returns table (destino text, mio boolean)
language sql
security definer
set search_path = public
stable
as $$
  select s.address_street, true
    from public.shipments s
   where s.preasignado_a = auth.uid()
     and s.assigned_driver is null
     and s.status in ('creado', 'pendiente_retiro')
     -- Los de otro día no se pueden retirar todavía (paso 14).
     and coalesce(s.scheduled_date, public.fecha_local()) <= public.fecha_local()
     /*
      * La dirección se compara sin mayúsculas ni espacios de más.
      *
      * Hace falta porque las dos puntas se escriben distinto: la colecta
      * guarda lo que se escribió al mandarla y el envío lo que se escribió al
      * cargarlo. "Independencia 2684" y "INDEPENDENCIA 2684 " son el mismo
      * lugar y tienen que cruzarse igual.
      */
     and lower(btrim(coalesce(s.pickup_address, ''))) = lower(btrim(p_direccion))
   order by s.id
   limit 40;
$$;

comment on function public.paquetes_de_colecta(text) is
  'Direcciones de entrega de los envíos preasignados al que pregunta y todavía '
  'sin retirar en ese comercio. Los que no tienen dueño NO se listan: los '
  'reparte la oficina. Sólo la dirección: lo demás recién cuando escanea.';

grant execute on function public.paquetes_de_colecta(text) to authenticated;

-- ---------------------------------------------------------------- comprobación
--
-- Como vos (admin) tiene que dar CERO filas: no tenés envíos preasignados.
--
--   select * from public.paquetes_de_colecta('INDEPENDENCIA 2684');
