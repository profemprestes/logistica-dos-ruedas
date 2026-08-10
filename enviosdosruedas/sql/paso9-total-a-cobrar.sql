-- ============================================================================
--  PASO 9 — "Total a cobrar" editable
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  Hoy `amount_to_collect` es una columna GENERADA (la calcula la base como
--  envío + mercadería) y por eso no se puede tocar a mano. Pero en la mayoría
--  de tus clientes el envío YA viene incluido en lo que hay que cobrar, y en
--  otros se suma aparte. Eso no se puede resolver con una fórmula fija: tiene
--  que ser un campo que se edite envío por envío.
--
--  Este script la convierte en una columna común CONSERVANDO los valores que
--  ya tenían los envíos cargados.
-- ============================================================================

do $$
begin
  -- Sólo hace algo si todavía es generada; si ya se convirtió, no toca nada.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'shipments'
      and column_name = 'amount_to_collect'
      and is_generated = 'ALWAYS'
  ) then
    -- 1. copia de los valores actuales
    alter table public.shipments add column amount_to_collect_tmp numeric(12, 2);
    update public.shipments set amount_to_collect_tmp = amount_to_collect;

    -- 2. fuera la generada, entra la editable con los mismos valores
    alter table public.shipments drop column amount_to_collect;
    alter table public.shipments rename column amount_to_collect_tmp to amount_to_collect;

    -- 3. que nunca quede en null
    update public.shipments set amount_to_collect = 0 where amount_to_collect is null;
    alter table public.shipments alter column amount_to_collect set default 0;
    alter table public.shipments alter column amount_to_collect set not null;

    raise notice 'amount_to_collect convertida a columna editable.';
  else
    raise notice 'amount_to_collect ya era editable: no se hizo nada.';
  end if;
end $$;

-- PostgREST guarda el esquema en memoria: sin esto sigue creyendo que es generada.
notify pgrst, 'reload schema';
