-- ============================================================================
--  PASO 57 — Los productos siguen la misma numeración que los envíos
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  El paso 56 traía un prefijo por comercio (CN00000001EDR), heredado del
--  sistema viejo. No va: en esta empresa hay UNA numeración, la de los envíos
--  — EDR00001216MDQ y sigue. Los productos del depósito entran a esa misma
--  serie.
--
--  CÓMO. El código del envío es su id disfrazado: `set_tracking_code` (armado
--  original) hace 'EDR' || lpad(id) || 'MDQ', y ese id sale de la secuencia de
--  `shipments`. Los productos toman su número DE LA MISMA SECUENCIA: el número
--  que usa un producto queda consumido y el próximo envío sigue después, así
--  un producto y un envío no pueden salir con el mismo código ni corriendo a
--  la vez. El hueco que queda en los ids de envíos no molesta: ya hay huecos
--  de los envíos borrados.
--
--  Se puede cambiar sin migrar nada: al 25/08/2026 no hay ningún producto
--  cargado.
-- ============================================================================


-- ------------------------------------------------------- 1. la función nueva
--
--  Sigue pidiendo el comercio, pero sólo para controlar que maneje stock: el
--  número no es suyo, es de la serie única de la empresa.

create or replace function public.siguiente_codigo_producto(p_client_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_maneja boolean;
  v_num    bigint;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  select maneja_stock into v_maneja from public.clients where id = p_client_id;

  if v_maneja is null then
    raise exception 'COMERCIO_NO_ENCONTRADO';
  end if;

  if not v_maneja then
    raise exception 'SIN_STOCK_EN_BASE';
  end if;

  -- El mismo mostrador que numera los envíos. `pg_get_serial_sequence`
  -- resuelve el nombre real de la secuencia, así esto no se rompe si algún
  -- día la tabla se recrea con otro nombre interno.
  v_num := nextval(pg_get_serial_sequence('public.shipments', 'id'));

  return 'EDR' || lpad(v_num::text, 8, '0') || 'MDQ';
end;
$$;

grant execute on function public.siguiente_codigo_producto(bigint) to authenticated;


-- ------------------------------------- 2. afuera el prefijo y el contador
--
--  Nadie los usa más. Dejarlos sería invitar a que algún código futuro los
--  vuelva a leer y salgan dos numeraciones.

alter table public.clients
  drop column if exists stock_prefijo,
  drop column if exists stock_contador;

-- Y la secuencia aparte que el 56 no llegó a necesitar, por si quedó creada.
drop sequence if exists public.stock_codigo_seq;

commit;

-- ============================================================
-- PARA MIRAR DESPUÉS DE CORRERLO
--
-- 1) Que las columnas se hayan ido (tiene que devolver cero filas):
--      select column_name from information_schema.columns
--       where table_name = 'clients' and column_name like 'stock_pre%';
--
-- 2) El primer producto que cargues va a salir con el número que sigue al
--    último envío, tipo EDR000012xxMDQ — la misma serie de siempre.
-- ============================================================
