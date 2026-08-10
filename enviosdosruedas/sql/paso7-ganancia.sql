-- ============================================================================
--  PASO 7 — Ganancia del día en el cierre de caja
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  El repartidor ve en su celular el valor bruto de los envíos que hizo, SIN
--  descontar comisión. Acá el admin anota a mano cuánto queda para la empresa
--  ese día. Por ahora la cuenta es manual; el día que se automatice, esta misma
--  columna sirve para guardar el resultado.
-- ============================================================================

alter table public.settlements
  add column if not exists shipping_total numeric(12, 2),
  add column if not exists earnings       numeric(12, 2);

comment on column public.settlements.shipping_total is
  'Suma del valor de los envíos entregados ese día, sin descontar comisión.';

comment on column public.settlements.earnings is
  'Ganancia del día para la empresa, cargada a mano por el admin (ya con la comisión descontada).';
