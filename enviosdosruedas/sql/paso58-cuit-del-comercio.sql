-- ============================================================================
--  PASO 58 — El CUIT del comercio
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  Un dato y nada más: el CUIT en la ficha, para tenerlo a mano cuando piden
--  factura. Opcional a propósito — la mayoría de los comercios no factura, y
--  exigirlo trabaría el alta de todos por el dato de unos pocos.
-- ============================================================================

alter table public.clients
  add column if not exists cuit text;

comment on column public.clients.cuit is
  'CUIT de la empresa, para cuando piden factura. Opcional (paso 58).';

commit;
