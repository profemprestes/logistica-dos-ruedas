-- ============================================================================
--  PASO 46 — Terminar lo del 45: sacar TODAS las lecturas viejas de comercios
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  QUÉ PASÓ. El paso 45 borró la política de lectura por su nombre y creó la
--  nueva, pero al probarlo la cuenta de un repartidor seguía viendo los 14
--  comercios. O sea que había otra permitiendo leer, con otro nombre.
--
--  Y ASÍ FUNCIONAN ESTOS PERMISOS: si hay varias políticas de lectura sobre la
--  misma tabla, alcanza con que UNA deje pasar. No se restan, se suman. Una
--  política vieja y olvidada anula silenciosamente a la nueva, sin ningún
--  error: todo "funciona", sólo que sigue abierto.
--
--  ASÍ QUE ESTA VEZ NO SE BORRA POR NOMBRE. Se recorren las que haya y se
--  borran todas las de lectura, se llamen como se llamen. Después se crea una
--  sola, la buena.
--
--  NO SE TOCAN LAS DE ESCRITURA: cargar y corregir comercios es de la oficina y
--  eso sigue igual. La del paso 40 ("los comercios los maneja el admin") es
--  `for all` y se deja como está.
--
--  Al correrlo, en la solapa de mensajes te va a decir cuáles borró.
-- ============================================================================

do $$
declare
  v_pol record;
  v_hubo boolean := false;
begin
  for v_pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'clients'
       and cmd        = 'SELECT'
  loop
    execute format('drop policy %I on public.clients', v_pol.policyname);
    raise notice 'Se borró la política de lectura: %', v_pol.policyname;
    v_hubo := true;
  end loop;

  if not v_hubo then
    raise notice 'No había ninguna política de lectura. Se crea la nueva.';
  end if;
end $$;

create policy "el repartidor ve los comercios a los que va"
  on public.clients for select
  to authenticated
  using (
    public.es_admin()
    or exists (
      select 1
        from public.shipments s
       where s.client_id = clients.id
         and (s.assigned_driver = auth.uid() or s.preasignado_a = auth.uid())
    )
  );

-- ---------------------------------------------------------------- comprobación
--
--  1. Que haya UNA SOLA política de lectura, y que sea ésta:
--
--     select policyname, cmd from pg_policies
--      where schemaname = 'public' and tablename = 'clients' order by cmd;
--
--  2. Como vos (admin) tienen que salir los 14:
--
--     select count(*) from public.clients;
