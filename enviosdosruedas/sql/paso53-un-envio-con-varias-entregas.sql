-- ============================================================
-- PASO 53 · UN ENVÍO CON VARIAS ENTREGAS
-- ============================================================
--
-- EL CASO. EL CONDOR, sucursal Colón y Neuquén, todos los viernes despacha
-- dos paquetes que salen del mismo retiro y van a dos direcciones distintas.
-- Para el comercio es UN envío y paga UN precio; para la calle son DOS
-- entregas, cada una con su destinatario, su punto en el mapa, su foto y su
-- estado.
--
-- POR QUÉ NO SE AGREGA UNA SEGUNDA DIRECCIÓN A LA FILA. Porque no es una
-- dirección más: es una entrega entera. Tiene su propio "entregado" o "no
-- entregado", su comprobante, su seguimiento para mandarle a quien espera, y
-- puede fallar sola y reprogramarse sola. Metida como un campo extra, todo eso
-- habría que duplicarlo columna por columna, y el día que sean tres entregas
-- habría que hacerlo de nuevo.
--
-- LO QUE SE AGREGA. Una sola columna: `parte_de`. Cada entrega sigue siendo un
-- envío completo; las que no son la primera apuntan a la primera. Esa primera
-- —la CABEZA— es la que lleva el precio. Las otras van en cero, y por eso la
-- suma del día da un solo envío aunque se hayan hecho dos paradas.
--
-- QUÉ NO CAMBIA. Los permisos. Cada entrega se sigue viendo por su comercio y
-- por su repartidor igual que antes: atarlas no le abre ninguna puerta a nadie.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. La columna
-- ------------------------------------------------------------

alter table public.shipments
  add column if not exists parte_de bigint
    references public.shipments (id) on delete set null;

comment on column public.shipments.parte_de is
  'Si esta entrega es parte de un envío con varias paradas, el id de la primera '
  '(la que lleva el precio). Null si es un envío común de una sola entrega.';

-- Sólo se indexan las que están atadas: son un puñado por semana y el índice
-- parcial no hace pagar nada a los miles de envíos sueltos.
create index if not exists shipments_parte_de
  on public.shipments (parte_de)
  where parte_de is not null;

-- ------------------------------------------------------------
-- 2. Que no se pueda armar un disparate
-- ------------------------------------------------------------
--
-- Tres reglas, y las tres se comprueban acá y no sólo en la pantalla: la
-- pantalla es una, la base la tocan el panel, los scripts y la mano.

create or replace function public.parte_de_valida()
returns trigger
language plpgsql
as $$
declare
  cabeza public.shipments%rowtype;
begin
  if new.parte_de is null then
    return new;
  end if;

  if new.parte_de = new.id then
    raise exception 'Un envío no puede ser parte de sí mismo.';
  end if;

  select * into cabeza from public.shipments where id = new.parte_de;

  if not found then
    raise exception 'La entrega principal no existe.';
  end if;

  -- Un solo nivel. Sin esto se podría armar una cadena —A parte de B, B parte
  -- de C— y ya no habría forma de contestar "¿cuánto sale este envío?" sin
  -- perseguirla hasta el final.
  if cabeza.parte_de is not null then
    raise exception 'Esa entrega ya es parte de otro envío: todas las paradas van colgadas de la primera.';
  end if;

  -- Del mismo comercio. Un envío es de alguien; dos entregas de dos comercios
  -- distintos no son un envío con dos paradas, son dos envíos.
  if cabeza.client_id is distinct from new.client_id then
    raise exception 'Las entregas de un mismo envío tienen que ser del mismo comercio.';
  end if;

  return new;
end;
$$;

drop trigger if exists shipments_parte_de_valida on public.shipments;
create trigger shipments_parte_de_valida
  before insert or update of parte_de, client_id on public.shipments
  for each row execute function public.parte_de_valida();

-- ------------------------------------------------------------
-- 3. Si se borra la cabeza, el precio no se pierde
-- ------------------------------------------------------------
--
-- Sin esto pasaba algo callado y feo: la cabeza lleva el precio y las otras van
-- en cero. Al borrar la cabeza, la clave foránea les dejaba `parte_de` en null
-- y quedaban como envíos sueltos de $ 0 — el trabajo hecho y la plata
-- desaparecida, sin que nada lo dijera.
--
-- Ahora la primera que queda hereda el precio y las demás se le cuelgan. El
-- envío sigue valiendo lo mismo con una entrega menos.

create or replace function public.al_borrar_la_cabeza()
returns trigger
language plpgsql
as $$
declare
  heredera bigint;
begin
  select id into heredera
    from public.shipments
   where parte_de = old.id
   order by id
   limit 1;

  if heredera is null then
    return old;
  end if;

  update public.shipments
     set parte_de = null,
         shipping_fee = old.shipping_fee,
         payment_mode = old.payment_mode
   where id = heredera;

  update public.shipments
     set parte_de = heredera
   where parte_de = old.id
     and id <> heredera;

  return old;
end;
$$;

drop trigger if exists shipments_al_borrar_cabeza on public.shipments;
create trigger shipments_al_borrar_cabeza
  before delete on public.shipments
  for each row execute function public.al_borrar_la_cabeza();

-- ------------------------------------------------------------
-- 4. Una entrega reprogramada sigue siendo parte del mismo envío
-- ------------------------------------------------------------
--
-- Cuando una entrega no se puede hacer, `reprogramar_envio` (paso 31/32) deja
-- el intento fallido como registro y nace un envío nuevo copiado del viejo.
-- Copia el precio, pero no sabía de `parte_de`.
--
-- Sin esto, la segunda entrega de un envío que se reprograma nacía suelta y en
-- cero: perdía el vínculo con su hermana —el repartidor ya no veía "son dos
-- paquetes"— y encima aparecía en el cierre de caja como "envío sin valor
-- cargado", mandando a buscar un precio que no falta.
--
-- Va como disparador y no tocando la función a propósito: la función es larga y
-- reescribirla entera para agregarle una columna es la clase de cambio en el
-- que se pierde una línea sin que nadie lo note. Corre antes que la validación
-- de arriba, por orden alfabético del nombre.

create or replace function public.hereda_parte_de()
returns trigger
language plpgsql
as $$
begin
  if new.reintento_de is null or new.parte_de is not null then
    return new;
  end if;

  select parte_de into new.parte_de
    from public.shipments
   where id = new.reintento_de;

  return new;
end;
$$;

drop trigger if exists shipments_hereda_parte_de on public.shipments;
create trigger shipments_hereda_parte_de
  before insert on public.shipments
  for each row execute function public.hereda_parte_de();

commit;

-- ============================================================
-- PARA MIRAR DESPUÉS DE CORRERLO
-- ============================================================
--
-- Los envíos que tienen más de una entrega, con sus paradas:
--
--   select c.tracking_code as envio,
--          c.shipping_fee  as precio,
--          count(p.id) + 1 as entregas,
--          string_agg(p.tracking_code, ', ' order by p.id) as las_otras
--     from public.shipments c
--     join public.shipments p on p.parte_de = c.id
--    group by c.id, c.tracking_code, c.shipping_fee
--    order by c.id desc;
--
-- Ninguna entrega colgada de algo que no existe (tiene que dar 0 filas):
--
--   select s.id, s.tracking_code
--     from public.shipments s
--    where s.parte_de is not null
--      and not exists (select 1 from public.shipments c where c.id = s.parte_de);
-- ============================================================
