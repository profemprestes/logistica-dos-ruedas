-- ============================================================================
--  PASO 6 — Envíos FLEX
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  Un envío FLEX lo gestiona Mercado Libre: el repartidor lo lleva igual, pero
--  la entrega se cierra en la app de Envíos Flex, no en la nuestra. Acá sólo
--  queda el registro de que lo entregó, con la ubicación y la hora.
-- ============================================================================

alter table public.shipments
  add column if not exists is_flex boolean not null default false;

comment on column public.shipments.is_flex is
  'Envío de Mercado Libre Flex: no se cobra ni se pide comprobante en esta app; '
  'el repartidor tiene que cerrarlo en la app de Envíos Flex.';

-- Para filtrarlos rápido en el panel sin recorrer toda la tabla.
create index if not exists shipments_flex_idx on public.shipments (is_flex) where is_flex;
