-- ============================================================
-- PASO 54 · CORREGIR LO QUE SE COBRÓ DE VERDAD
-- ============================================================
--
-- EL CASO. El 20/08/2026, EDR00001147MDQ salió con $ 65.230 a cobrar. En la
-- puerta se terminó cobrando $ 36.900. El repartidor cerró la entrega con el
-- monto que traía el envío, así que en la caja quedaron $ 65.230 — o sea que el
-- sistema le estaba pidiendo rendir $ 28.330 que nunca tuvo en la mano.
--
-- Cambiar el monto en la ficha del envío no arregla nada, y está bien que no lo
-- arregle: la caja cuenta LO QUE SE COBRÓ, no lo que se esperaba cobrar. Lo que
-- faltaba era poder corregir ese número cuando la calle dice otra cosa.
--
-- POR QUÉ NO SE PISA `amount_collected`. Ese es el número que cargó el
-- repartidor al cerrar, y es un hecho: él dijo eso, a esa hora, con esa foto.
-- Si se pisara, la corrección sería indistinguible de que hubiera cargado bien
-- desde el principio, y el día que haya una discusión de plata no quedaría
-- rastro de quién dijo qué. Se guarda al lado, con quién la hizo y por qué.
--
-- QUIÉN PUEDE. Sólo la oficina, y por una función con `security definer`, para
-- no tener que abrirle a nadie el permiso de escribir sobre los movimientos.
-- Un movimiento es el registro de algo que pasó; se corrige por esta puerta o
-- por ninguna.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. Dónde se guarda la corrección
-- ------------------------------------------------------------

alter table public.delivery_logs
  add column if not exists cobrado_corregido numeric,
  add column if not exists correccion_nota   text,
  add column if not exists corregido_por     uuid references public.profiles (id),
  add column if not exists corregido_en      timestamptz;

comment on column public.delivery_logs.cobrado_corregido is
  'Lo que se cobró DE VERDAD, cuando no fue lo que cargó el repartidor. Null si '
  'no hubo que corregir nada. Manda sobre `amount_collected` en todas las cuentas.';

comment on column public.delivery_logs.correccion_nota is
  'Por qué se corrigió. Lo escribe la oficina y lo ve el repartidor en su caja.';

-- ------------------------------------------------------------
-- 2. La función que corrige
-- ------------------------------------------------------------

create or replace function public.corregir_cobrado(
  p_log    uuid,
  p_monto  numeric,
  p_nota   text default null
)
returns public.delivery_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.delivery_logs;
begin
  if not public.es_admin() then
    raise exception 'SOLO_ADMIN';
  end if;

  select * into v_log from public.delivery_logs where id = p_log;

  if v_log.id is null then
    raise exception 'MOVIMIENTO_NO_ENCONTRADO';
  end if;

  -- Sólo se corrige plata donde pudo haber plata. En un "no entregado" no se
  -- cobró nada y no hay nada que corregir.
  if v_log.event not in ('entregado', 'retirado') then
    raise exception 'ESE_MOVIMIENTO_NO_COBRA';
  end if;

  if p_monto is null or p_monto < 0 then
    raise exception 'MONTO_INVALIDO';
  end if;

  /*
   * Corregir al mismo número que ya tenía es DESHACER la corrección, no
   * escribir una igual. Si no, un envío que nunca estuvo mal quedaría marcado
   * como corregido y el cartel dejaría de significar algo.
   */
  if p_monto = coalesce(v_log.amount_collected, 0) then
    update public.delivery_logs
       set cobrado_corregido = null,
           correccion_nota   = null,
           corregido_por     = null,
           corregido_en      = null
     where id = p_log
    returning * into v_log;

    return v_log;
  end if;

  update public.delivery_logs
     set cobrado_corregido = p_monto,
         correccion_nota   = nullif(btrim(coalesce(p_nota, '')), ''),
         corregido_por     = auth.uid(),
         corregido_en      = now()
   where id = p_log
  returning * into v_log;

  return v_log;
end;
$$;

revoke all on function public.corregir_cobrado(uuid, numeric, text) from public;
grant execute on function public.corregir_cobrado(uuid, numeric, text) to authenticated;

commit;

-- ============================================================
-- PARA MIRAR DESPUÉS DE CORRERLO
-- ============================================================
--
-- Las correcciones hechas, con la diferencia:
--
--   select s.tracking_code,
--          l.happened_at,
--          l.amount_collected  as cargo_el_repartidor,
--          l.cobrado_corregido as se_cobro_de_verdad,
--          l.cobrado_corregido - l.amount_collected as diferencia,
--          l.correccion_nota,
--          p.full_name as la_corrigio
--     from public.delivery_logs l
--     join public.shipments s on s.id = l.shipment_id
--     left join public.profiles p on p.id = l.corregido_por
--    where l.cobrado_corregido is not null
--    order by l.corregido_en desc;
-- ============================================================
