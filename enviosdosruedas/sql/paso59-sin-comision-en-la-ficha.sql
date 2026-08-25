-- ============================================================================
--  PASO 59 — "Sin comisión" es una marca de la ficha
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  Hasta acá, qué comercios van sin comisión vivía en una lista adentro del
--  código (REGLAS: Killari, Shopigo, Shippy, Flow). Para el próximo cliente
--  con arreglo directo había que tocar código y publicar. Con la marca en la
--  ficha, se prende la casilla y listo: el valor del envío va entero al
--  repartidor y no se le muestra en su portal.
--
--  LOS NÚMEROS ACORDADOS ($3.000 de Shippy, $2.000/$3.000 de Flow) siguen en
--  REGLAS: son tarifas puntuales de esos arreglos. La casilla cubre el caso
--  general — sin comisión, con el valor que se cargue en cada envío.
-- ============================================================================

alter table public.clients
  add column if not exists sin_comision boolean not null default false;

comment on column public.clients.sin_comision is
  'Arreglo directo: el valor del envío va entero al repartidor, sin comisión, y no se muestra en su portal (paso 59).';

-- Los que ya van así por las REGLAS quedan marcados también en su ficha, para
-- que la casilla diga la verdad al abrirla.
update public.clients
   set sin_comision = true
 where upper(name) similar to '%(KILLARI|SHOPIGO|SHIPPY|CONECTTA)%';

commit;

-- ============================================================
-- PARA MIRAR DESPUÉS DE CORRERLO
--
--   select id, name, sin_comision from public.clients
--    where sin_comision order by name;
--   (tienen que salir SHIPPY, KILLARI, SHOPIGO y FLOW (CONECTTA))
-- ============================================================
