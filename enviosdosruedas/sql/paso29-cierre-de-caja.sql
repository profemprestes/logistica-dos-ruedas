-- ============================================================================
--  PASO 29 — Arreglo: no deja hacer el cierre de caja
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  EL SÍNTOMA: "new row violates row-level security policy for table
--  settlements" al cerrar la caja del día.
--
--  QUÉ PASA. El permiso de admin sobre esa tabla se escribió así:
--
--      exists (select 1 from public.profiles p
--               where p.id = auth.uid() and p.role = 'admin')
--
--  Esa consulta corre COMO VOS, así que a su vez tiene que pasar por los
--  permisos de `profiles`. Si por lo que sea ahí no podés leer tu propia fila
--  —un permiso que cambió, una sesión vieja—, la cuenta da "no sos admin" y la
--  tabla rechaza la escritura. El permiso depende de otro permiso, y eso es
--  exactamente lo que lo hace frágil.
--
--  El resto del sistema no lo hace así: usa `es_admin()`, que es una función
--  SECURITY DEFINER —corre con los permisos de quien la creó, no con los
--  tuyos— y por eso siempre puede mirar `profiles`. Es la misma pregunta,
--  contestada por alguien que sí tiene la llave.
--
--  Al final hay dos cosas más: una prueba que se deshace sola, y el listado de
--  los permisos que quedaron, para ver con qué nos quedamos.
-- ============================================================================

-- El repartidor sigue viendo la suya y sólo la suya. No se toca, se deja
-- escrita para que este archivo cuente la historia completa de la tabla.
drop policy if exists "repartidor ve su liquidacion" on public.settlements;
create policy "repartidor ve su liquidacion"
  on public.settlements for select
  to authenticated
  using (driver_id = auth.uid());

drop policy if exists "admin maneja liquidaciones" on public.settlements;
create policy "admin maneja liquidaciones"
  on public.settlements for all
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());


-- ---------------------------------------------------- la prueba de verdad
--
--  Hace el cierre de caja COMO VOS, sobre un repartidor real, y después se
--  deshace: no queda ninguna fila. Es la única forma de saber si esto quedó
--  arreglado sin salir a probarlo en el panel.

do $$
declare
  v_admin    uuid;
  v_driver   uuid;
  v_nombre   text;
begin
  select p.id into v_admin from public.profiles p where p.role = 'admin' limit 1;

  select p.id, p.full_name into v_driver, v_nombre
    from public.profiles p
   where p.role = 'repartidor'
   order by p.full_name
   limit 1;

  if v_admin is null or v_driver is null then
    raise notice 'Falta un admin o un repartidor para probar.';
    return;
  end if;

  -- Nos hacemos pasar por el admin, sólo durante esta transacción.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.settlements (driver_id, day, cash_total, actual_amount, settled_at, settled_by)
  values (v_driver, date '1999-01-01', 0, 0, now(), v_admin);

  raise notice 'ANDA: el admin pudo cerrar la caja de % ', v_nombre;
  raise exception 'DESHACER';

exception
  when others then
    if sqlerrm = 'DESHACER' then
      raise notice 'Listo. Se deshizo la prueba: no quedó ninguna fila.';
    else
      raise notice 'SIGUE FALLANDO: %', sqlerrm;
    end if;
end $$;


-- ------------------------------------------------------------------ control
--
--  Con qué permisos quedó la tabla. Tienen que aparecer los dos de arriba, y
--  el del admin diciendo `es_admin()` en las dos columnas.
select
  policyname as permiso,
  cmd        as para_que,
  qual       as leer,
  with_check as escribir
from pg_policies
where schemaname = 'public' and tablename = 'settlements'
order by policyname;
