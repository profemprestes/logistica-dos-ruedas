-- PASO 55: LA BILLETERA DEL REPARTIDOR
--
-- Se pega entero en Supabase -> SQL Editor -> Run. Se puede correr mas de una
-- vez sin romper nada.
--
-- EL PROBLEMA. Lo rendido vivia adentro del cierre de UN DIA, en
-- `settlements.actual_amount`. Pero la plata no se entrega por dia: el
-- repartidor junta lo de varias jornadas y un martes deja un monto que cubre
-- todo. El 12/08/2026 quedo escrito asi: cobro $ 9.900 y rindio $ 55.000. El
-- numero es cierto, pero pegado a un dia al que no pertenece.
--
-- Por eso el saldo de "Caja y ganancia" avisa que en una ventana de dias miente:
-- una rendicion del martes tapa lo cobrado del lunes. Habia que mirar
-- "Acumulado" para creerle, y aun asi no habia forma de anotar una entrega de
-- plata que no fuera cerrando un dia.
--
-- LO QUE SE AGREGA. Una cuenta corriente por repartidor. Cada vez que entrega
-- plata, o cada vez que se le paga lo suyo, queda un movimiento con SU fecha y
-- SU monto. El saldo sale de sumar todo desde el principio, no de una ventana.
--
-- DOS PLATAS QUE VAN EN SENTIDOS CONTRARIOS, y por eso el tipo:
--
--   · `rendicion` — el repartidor entrega efectivo que cobro en la calle.
--     Baja lo que DEBE.
--   · `pago`      — la empresa le paga su parte de los envios.
--     Baja lo que se le DEBE a el.
--   · `ajuste`    — cualquier otra cosa que mueva el saldo y haya que explicar.
--     Es el unico que admite monto negativo.

begin;

-- ------------------------------------------------------------
-- 1. La cuenta corriente
-- ------------------------------------------------------------

create table if not exists public.movimientos_caja (
  id          bigserial primary key,
  driver_id   uuid        not null references public.profiles (id) on delete cascade,
  fecha       date        not null,
  tipo        text        not null check (tipo in ('rendicion', 'pago', 'ajuste')),
  monto       numeric     not null,
  nota        text,
  cargado_por uuid        references public.profiles (id),
  created_at  timestamptz not null default now(),

  -- Una rendicion de cero no es un hecho: es un formulario vacio guardado sin
  -- querer. Solo el ajuste puede ir en negativo, y para eso existe.
  constraint monto_con_sentido check (
    (tipo = 'ajuste' and monto <> 0) or (tipo <> 'ajuste' and monto > 0)
  )
);

comment on table public.movimientos_caja is
  'Cuenta corriente de cada repartidor: lo que entrega y lo que se le paga. El '
  'saldo sale de esto mas lo cobrado en la calle, desde el principio.';

create index if not exists movimientos_caja_driver
  on public.movimientos_caja (driver_id, fecha);

-- ------------------------------------------------------------
-- 2. Quien ve y quien escribe
-- ------------------------------------------------------------
--
-- El repartidor MIRA la suya y no escribe. Anotar que entrego plata es un acto
-- de la oficina: es la que la recibe.

alter table public.movimientos_caja enable row level security;

/*
 * Se borran en un bucle sobre `pg_policies` y no por nombre.
 *
 * En esta base conviven politicas hechas a mano con las de los pasos, y una
 * politica vieja que nadie recuerda no molesta hasta que deja pasar algo: los
 * permisos SUMAN, asi que basta una sobrante para que la restriccion nueva no
 * sirva de nada. Borrando por tabla no queda ninguna afuera.
 */
do $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'movimientos_caja'
  loop
    execute format('drop policy %I on public.movimientos_caja', p.policyname);
  end loop;
end $$;

create policy "el repartidor ve su billetera"
  on public.movimientos_caja for select
  using (driver_id = auth.uid() or public.es_admin());

create policy "solo la oficina anota"
  on public.movimientos_caja for insert
  with check (public.es_admin());

create policy "solo la oficina corrige"
  on public.movimientos_caja for update
  using (public.es_admin()) with check (public.es_admin());

create policy "solo la oficina borra"
  on public.movimientos_caja for delete
  using (public.es_admin());

-- ------------------------------------------------------------
-- 3. Lo que ya estaba rendido, del 17/08 en adelante, se muda
-- ------------------------------------------------------------
--
-- Los `actual_amount` de los cierres son rendiciones de verdad y tienen que
-- estar en la cuenta corriente: si no, el saldo arranca diciendo que el
-- repartidor debe una plata que ya entrego.
--
-- PERO SOLO DESDE EL LUNES 17/08/2026. Antes de esa fecha el sistema se estaba
-- probando: los numeros que quedaron son de ensayo y meterlos en la cuenta
-- corriente seria arrancar con un saldo inventado. Al 20/08/2026 las dos unicas
-- rendiciones guardadas son del 12 y del 13, asi que esto no muda nada — y esta
-- bien que no lo haga.
--
-- La misma fecha esta en `lib/billetera.ts`, y las dos tienen que decir lo
-- mismo: si aca se cuenta desde un dia y alla desde otro, el saldo de la
-- pantalla no va a coincidir con el de la base.
--
-- Se mudan con la fecha del cierre, que es la que se sabe. Si la entrega fue
-- otro dia, se corrige desde la pantalla.
--
-- No se repiten si esto se corre dos veces: se mira que no exista ya una
-- rendicion de ese repartidor, esa fecha y ese monto venida de aca.

insert into public.movimientos_caja (driver_id, fecha, tipo, monto, nota, cargado_por, created_at)
select s.driver_id,
       s.day,
       'rendicion',
       s.actual_amount,
       'Del cierre del dia (paso 55)',
       s.settled_by,
       coalesce(s.settled_at, now())
  from public.settlements s
 where s.actual_amount is not null
   and s.actual_amount > 0
   and s.day >= date '2026-08-17'
   and not exists (
     select 1 from public.movimientos_caja m
      where m.driver_id = s.driver_id
        and m.fecha     = s.day
        and m.monto     = s.actual_amount
        and m.nota      = 'Del cierre del dia (paso 55)'
   );

commit;

-- ============================================================
-- PARA MIRAR DESPUES DE CORRERLO
-- ============================================================
--
-- La cuenta corriente de cada uno:
--
--   select p.full_name,
--          m.fecha, m.tipo, m.monto, m.nota
--     from public.movimientos_caja m
--     join public.profiles p on p.id = m.driver_id
--    order by p.full_name, m.fecha desc;
--
-- Lo que se mudo de los cierres viejos (tienen que ser 2 al 20/08/2026):
--
--   select count(*) from public.movimientos_caja
--    where nota = 'Del cierre del dia (paso 55)';
-- ============================================================
