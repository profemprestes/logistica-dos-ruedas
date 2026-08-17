-- ============================================================================
--  PASO 43 — Los paquetes sin dueño también se ven, y los de otro día no
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  DOS ARREGLOS AL PASO 42.
--
--  1) LOS QUE NO TIENEN DUEÑO. Escanear un envío sin preasignar lo toma
--     cualquiera —así está hecho y así tiene que quedar, porque la mayoría de
--     los envíos no se preasignan y exigirlo frenaría la operación entera—.
--     Pero entonces el repartidor llega al comercio, hay cinco paquetes, tres
--     son suyos y dos son de nadie, y los dos de nadie no le aparecen: tiene
--     que preguntar igual. Que preguntara es exactamente lo que la lista venía
--     a evitar.
--
--     Ahora salen los dos grupos, separados. `mio` dice cuál es cuál: los
--     suyos son suyos, y los libres se muestran como lo que son —el que llega
--     primero se los lleva— para que decida él o pregunte por WhatsApp.
--
--     Los preasignados A OTRO siguen sin aparecer. Ésos no puede llevárselos
--     ni aunque quiera: el escáner lo frena y le dice de quién son.
--
--  2) LOS DE OTRO DÍA NO VAN. El paso 42 no miraba `scheduled_date`, así que
--     un envío cargado para el martes que viene aparecía en la lista de hoy.
--     Y no lo puede ni escanear: el candado del paso 14 se lo frena. Sería
--     mandarlo a buscar algo que el sistema no le va a dejar tomar.
-- ============================================================================

-- La función cambia lo que devuelve (ahora son dos columnas), y eso Postgres
-- no lo deja hacer con un `create or replace`. Se borra y se crea de nuevo.
drop function if exists public.paquetes_de_colecta(text);

create or replace function public.paquetes_de_colecta(p_direccion text)
returns table (destino text, mio boolean)
language sql
security definer
set search_path = public
stable
as $$
  select s.address_street,
         s.preasignado_a = auth.uid() as mio
    from public.shipments s
   where s.assigned_driver is null
     and s.status in ('creado', 'pendiente_retiro')
     -- Suyo, o de nadie. Los de otro no: no puede llevárselos ni queriendo.
     and (s.preasignado_a = auth.uid() or s.preasignado_a is null)
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
   -- Los suyos primero: son los que seguro tiene que llevarse.
   order by (s.preasignado_a = auth.uid()) desc, s.id
   limit 40;
$$;

comment on function public.paquetes_de_colecta(text) is
  'Qué hay para retirar en ese comercio: los preasignados al que pregunta y los '
  'que no tienen dueño, marcados con `mio`. Sólo la dirección de entrega: lo '
  'demás recién cuando escanea.';

grant execute on function public.paquetes_de_colecta(text) to authenticated;

-- ---------------------------------------------------------------- comprobación
--
-- Como vos (admin), todo lo que salga tiene que tener mio = false: no tenés
-- envíos preasignados. Si aparece alguno en true, algo quedó mal.
--
--   select * from public.paquetes_de_colecta('INDEPENDENCIA 2684');
