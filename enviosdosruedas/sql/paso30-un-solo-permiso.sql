-- ============================================================================
--  PASO 30 — Un solo permiso por cosa en el cierre de caja
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  LO QUE APARECIÓ. La tabla `settlements` tiene los permisos DUPLICADOS, de
--  dos épocas distintas:
--
--    admin maneja liquidaciones          es_admin()   <- los del repo
--    admin: todo sobre liquidaciones     is_admin()   <- de antes, hechos a mano
--    repartidor ve su liquidacion        driver_id = auth.uid()
--    repartidor: ver sus liquidaciones   driver_id = auth.uid()
--
--  POR QUÉ ROMPE. Dos permisos que dicen lo mismo normalmente se suman: alcanza
--  con que uno diga que sí. PERO si alguno está marcado como RESTRICTIVO, deja
--  de sumar y pasa a mandar: hay que cumplirlo sí o sí. Ahí, aunque `es_admin()`
--  conteste que sos admin, si `is_admin()` contesta que no —porque mira otra
--  cosa, o porque quedó de una versión anterior— la tabla te rechaza igual. Y el
--  mensaje es siempre el mismo, sin decir cuál de los dos te frenó.
--
--  QUÉ HACE ESTE PASO. Primero muestra qué son los viejos y qué mira
--  `is_admin()`, para que quede escrito. Después borra los duplicados: quedan
--  los dos del repo y nada más. Uno por cosa.
--
--  Se borran SÓLO los de esta tabla. Si `is_admin()` la usan otras tablas,
--  siguen intactas: acá no se toca la función, sólo estos dos permisos.
-- ============================================================================

-- ------------------------------------------------- 1. qué había, para saberlo
do $$
declare
  r record;
begin
  raise notice '--- permisos de settlements ANTES ---';
  for r in
    select policyname, cmd, permissive, qual::text as leer, with_check::text as escribir
      from pg_policies
     where schemaname = 'public' and tablename = 'settlements'
     order by policyname
  loop
    raise notice '% | % | % | leer: % | escribir: %',
      rpad(r.policyname, 34), rpad(r.cmd, 6), r.permissive, r.leer, r.escribir;
  end loop;

  if to_regproc('public.is_admin') is null then
    raise notice 'is_admin() NO EXISTE: cualquier permiso que la use no se puede cumplir.';
  else
    raise notice '--- que mira is_admin() ---';
    raise notice '%', pg_get_functiondef(to_regproc('public.is_admin'));
  end if;
end $$;


-- ------------------------------------------------ 2. fuera los duplicados
--
--  Los del repo se dejan como están (los creó el paso 29). Se van los otros
--  dos, que dicen lo mismo con otras palabras.
drop policy if exists "admin: todo sobre liquidaciones" on public.settlements;
drop policy if exists "repartidor: ver sus liquidaciones" on public.settlements;


-- --------------------------------------------------- 3. la prueba de verdad
--
--  El cierre de caja, hecho COMO EL ADMIN, sobre un repartidor real y con la
--  tabla aplicando sus permisos de verdad. Después se deshace: no queda nada.
--
--  El cambio de rol es lo que hace que la prueba valga. Corriendo como dueño de
--  la tabla —que es como corre el editor de Supabase— los permisos NI SE MIRAN,
--  y la prueba diría que anda siempre, aunque estuviera todo mal.

do $$
declare
  v_admin  uuid;
  v_driver uuid;
  v_nombre text;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;
  select p.id, p.full_name into v_driver, v_nombre
    from public.profiles p where p.role = 'repartidor' order by p.full_name limit 1;

  if v_admin is null or v_driver is null then
    raise notice 'Falta un admin o un repartidor para probar.';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.settlements (driver_id, day, cash_total, actual_amount, settled_at, settled_by)
  values (v_driver, date '1999-01-01', 0, 0, now(), v_admin);

  raise notice 'ANDA: el admin pudo cerrar la caja de %', v_nombre;
  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: no quedó ninguna fila.';
    else
      raise notice 'SIGUE FALLANDO: %', sqlerrm;
    end if;
end $$;


-- ------------------------------------- 4. ¿pasa lo mismo en otras tablas?
--
--  Si `settlements` tenía dos generaciones de permisos encima, es razonable
--  que otras tablas también. Esto no toca nada: sólo avisa dónde mirar, para
--  no salir corrigiendo a ciegas lo que todavía funciona.

do $$
declare
  r record;
  hubo boolean := false;
begin
  raise notice '--- permisos RESTRICTIVOS (los que mandan sobre el resto) ---';
  for r in
    select tablename, policyname, cmd
      from pg_policies
     -- `permissive` es texto, no un si/no: dice 'PERMISSIVE' o 'RESTRICTIVE'.
     where schemaname = 'public' and permissive = 'RESTRICTIVE'
     order by tablename, policyname
  loop
    hubo := true;
    raise notice '  %.% (%)', r.tablename, r.policyname, r.cmd;
  end loop;
  if not hubo then raise notice '  ninguno: todos suman, ninguno manda.'; end if;

  hubo := false;
  raise notice '--- tablas con permisos repetidos para lo mismo ---';
  for r in
    select tablename, cmd, count(*) as cuantos
      from pg_policies
     where schemaname = 'public'
     group by tablename, cmd
    having count(*) > 1
     order by tablename
  loop
    hubo := true;
    raise notice '  % tiene % permisos para %', r.tablename, r.cuantos, r.cmd;
  end loop;
  if not hubo then raise notice '  ninguna: uno por cosa.'; end if;
end $$;


-- ------------------------------------------------------------------ control
--
--  Tienen que quedar DOS, los del repo, y los dos permisivos.
select
  policyname as permiso,
  cmd        as para_que,
  permissive as suma_o_manda,
  qual       as leer,
  with_check as escribir
from pg_policies
where schemaname = 'public' and tablename = 'settlements'
order by policyname;
