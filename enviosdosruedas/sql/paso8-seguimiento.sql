-- ============================================================================
--  PASO 8 — El repartidor ve su cierre de caja
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  El seguimiento público NO necesita SQL: la consulta la hace el servidor de la
--  app con la clave de servicio y devuelve sólo los datos que se pueden mostrar.
--  Así no hace falta abrirle `shipments` a cualquiera que pase por la web.
-- ============================================================================

alter table public.settlements enable row level security;

-- Que cada repartidor pueda leer SU liquidación (y sólo la suya).
drop policy if exists "repartidor ve su liquidacion" on public.settlements;
create policy "repartidor ve su liquidacion"
  on public.settlements for select
  to authenticated
  using (driver_id = auth.uid());

-- El admin sigue manejando todas.
drop policy if exists "admin maneja liquidaciones" on public.settlements;
create policy "admin maneja liquidaciones"
  on public.settlements for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
