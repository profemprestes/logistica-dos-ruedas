-- ============================================================================
--  PASO 19 — Los resúmenes de repartidor viven en la base
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR: la pestaña nueva del panel escribe en estas dos
--  tablas. Sin ellas, "Guardar" tira "relation does not exist".
--
--  De dónde sale esto: el generador de resúmenes era un HTML suelto que
--  guardaba todo en el `localStorage` del navegador de una sola PC. Eso quiere
--  decir que limpiar la caché borraba el historial entero, que no se podía
--  mirar desde el celular y que el único respaldo era un CSV exportado a mano.
--  El día 2 de julio, con 121 envíos y 33 comercios, colgaba de eso.
--
--  Dos tablas y no una: la de arriba es lo que se le manda al repartidor —los
--  totales y el texto tal como se envió— y la de abajo es el detalle renglón
--  por renglón, que es lo que después permite responderle a un comercio
--  cuánto se le debe sin volver a leer WhatsApp.
-- ============================================================================

create table if not exists public.driver_summaries (
  id             bigserial primary key,

  -- El repartidor puede no tener usuario en el sistema: durante la transición
  -- se liquida gente que todavía no está cargada. Por eso el nombre va SIEMPRE
  -- y el id es opcional; sin el nombre suelto, un resumen viejo de alguien que
  -- ya no está quedaría sin dueño.
  driver_id      uuid references public.profiles(id) on delete set null,
  driver_name    text not null,

  -- Un día suelto es desde = hasta. Así el resumen semanal no necesita otra
  -- forma de guardarse, que es lo que pasa cuando quedan cosas pendientes y se
  -- cierra la semana entera de una vez.
  desde          date not null,
  hasta          date not null,

  -- De dónde salieron los renglones: pegados de WhatsApp, traídos del sistema,
  -- o las dos cosas. Mientras no entre el 100% de los envíos a la app, lo
  -- normal va a ser 'mixto'.
  origen         text not null default 'pegado'
                 check (origen in ('pegado', 'sistema', 'mixto')),

  pendiente      numeric(12,2) not null default 0,
  rendido        numeric(12,2) not null default 0,
  excluir_efectivo_shippy boolean not null default false,

  -- Los totales se guardan calculados y no se recalculan al abrir el
  -- historial. Si mañana cambia la comisión, un resumen de hace tres meses
  -- tiene que seguir mostrando lo que se pagó ese día, no lo que se pagaría
  -- hoy.
  envios_normales numeric(12,2) not null default 0,
  envios_shippy   numeric(12,2) not null default 0,
  efectivo_normal numeric(12,2) not null default 0,
  efectivo_shippy numeric(12,2) not null default 0,
  pago_repartidor numeric(12,2) not null default 0,
  ganancia        numeric(12,2) not null default 0,
  a_rendir        numeric(12,2) not null default 0,

  -- El texto exacto que se mandó por WhatsApp. Es la prueba de lo que se
  -- acordó: si después hay una discusión, vale lo que se envió.
  texto           text,
  texto_compacto  text,

  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);

create index if not exists driver_summaries_fecha_idx
  on public.driver_summaries (hasta desc, desde desc);
create index if not exists driver_summaries_driver_idx
  on public.driver_summaries (driver_id, hasta desc);


create table if not exists public.driver_summary_items (
  id           bigserial primary key,
  summary_id   bigint not null references public.driver_summaries(id) on delete cascade,

  -- De qué envío salió, cuando salió del sistema. Los pegados a mano no tienen.
  -- `on delete set null`: borrar un envío no puede romper una liquidación ya
  -- cerrada.
  shipment_id  bigint references public.shipments(id) on delete set null,

  comercio     text not null default 'GENERAL',
  descripcion  text not null default '',
  cobrar       numeric(12,2) not null default 0,
  envio        numeric(12,2) not null default 0,
  es_shippy    boolean not null default false,

  -- Los productos que venían entre paréntesis en los pedidos de Shippy. Todavía
  -- no se muestran en ningún lado; se guardan igual porque el día que se haga
  -- el resumen de productos, los meses anteriores van a estar.
  productos    jsonb,

  orden        integer not null default 0
);

create index if not exists driver_summary_items_summary_idx
  on public.driver_summary_items (summary_id, orden);


-- --------------------------------------------------------------------- RLS
--
--  Esto es plata y liquidaciones: lo ve y lo toca únicamente el admin. Los
--  repartidores reciben su resumen por WhatsApp, no entran acá.

alter table public.driver_summaries      enable row level security;
alter table public.driver_summary_items  enable row level security;

drop policy if exists "resumenes: solo admin" on public.driver_summaries;
create policy "resumenes: solo admin"
  on public.driver_summaries for all
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());

drop policy if exists "renglones del resumen: solo admin" on public.driver_summary_items;
create policy "renglones del resumen: solo admin"
  on public.driver_summary_items for all
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());


-- ------------------------------------------------------------------ control
--
--  Después de correrlo, esto tiene que devolver las dos tablas con rowsecurity
--  en true:
--
--    select tablename, rowsecurity
--      from pg_tables
--     where schemaname = 'public'
--       and tablename in ('driver_summaries', 'driver_summary_items');
--
--  Y esto, dos políticas:
--
--    select tablename, policyname from pg_policies
--     where tablename in ('driver_summaries', 'driver_summary_items');
