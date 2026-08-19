-- ============================================================================
--  PASO 51 — El comercio pide cambiar sus datos, y vos los autorizás
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  QUÉ ABRE ESTO. Hasta hoy, un comercio que se muda o cambia de teléfono
--  tiene que avisar por WhatsApp y esperar a que alguien de la oficina lo
--  cargue. Con esto lo escribe él, y vos lo aprobás de un toque.
--
--  PIDE, NO CAMBIA. Y esa es la decisión de fondo. La dirección de retiro no
--  es un dato del comercio: es a dónde mandamos una moto todos los días. Si se
--  pudiera cambiar solo, un error de tipeo un domingo a la noche manda al
--  repartidor a otra cuadra el lunes a la mañana, y nadie se entera hasta que
--  llama. Un pedido que espera una confirmación no puede hacer eso.
--
--  LA CONTRASEÑA NO PASA POR ACÁ. Esa la cambia solo y al toque: es suya, no
--  afecta a nadie más, y hacerlo esperar una autorización para entrar a su
--  propia cuenta sería una traba sin motivo. Va por la API de Supabase y no
--  necesita ninguna tabla.
-- ============================================================================


-- ------------------------------------------------------- 1. los pedidos
--
--  Cada fila es UN pedido con todo lo que quiere que quede. No se guarda "el
--  cambio" sino el estado final deseado: así aprobar es copiar, sin tener que
--  interpretar nada, y el pedido se puede leer solo dentro de seis meses.

create table if not exists public.solicitudes_comercio (
  id bigserial primary key,
  client_id bigint not null references public.clients(id) on delete cascade,
  /** Quién lo pidió. Queda aunque después se le saque el acceso. */
  pedida_por uuid references public.profiles(id) on delete set null,

  phone text,
  pickup_address text,
  pickup_extra text,
  pickup_notes text,
  pickup_window text,
  /** Por si quiere aclarar algo: "nos mudamos el lunes". */
  nota text,

  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'aprobada', 'rechazada')),
  creada_at timestamptz not null default now(),
  resuelta_at timestamptz,
  resuelta_por uuid references public.profiles(id) on delete set null,
  /** Por qué se rechazó. Se le muestra al comercio. */
  motivo text
);

comment on table public.solicitudes_comercio is
  'Cambios de datos que pide un comercio y que la oficina aprueba (paso 51).';

/*
 * UN SOLO PEDIDO PENDIENTE POR COMERCIO.
 *
 * Sin esto, un comercio que toca "pedir" tres veces deja tres pedidos que se
 * contradicen, y aprobar el más viejo pisa lo que dice el más nuevo. Con uno
 * solo, el pedido siempre es "lo último que quiere", que es lo único que
 * tiene sentido aprobar.
 */
create unique index if not exists solicitudes_una_pendiente
  on public.solicitudes_comercio (client_id)
  where estado = 'pendiente';

create index if not exists solicitudes_pendientes_idx
  on public.solicitudes_comercio (estado, creada_at);


-- --------------------------------------------------------- 2. permisos
alter table public.solicitudes_comercio enable row level security;

-- El comercio ve las suyas: la pendiente y las que ya se resolvieron, para
-- saber si le dijeron que sí o que no.
drop policy if exists "el comercio ve sus solicitudes" on public.solicitudes_comercio;
create policy "el comercio ve sus solicitudes"
  on public.solicitudes_comercio for select
  to authenticated
  using (public.es_admin() or client_id in (select public.mis_comercios()));

/*
 * Y las crea, con dos candados en el `with check`.
 *
 * `client_id in (...)` para que no pueda pedir cambios de OTRO comercio, y
 * `estado = 'pendiente'` para que no pueda crear una ya aprobada y saltearse
 * la autorización, que es todo el punto de esto.
 */
drop policy if exists "el comercio pide cambios" on public.solicitudes_comercio;
create policy "el comercio pide cambios"
  on public.solicitudes_comercio for insert
  to authenticated
  with check (
    client_id in (select public.mis_comercios())
    and estado = 'pendiente'
    and pedida_por = auth.uid()
  );

-- Puede cancelar el suyo mientras nadie lo miró: es su pedido.
drop policy if exists "el comercio borra su pedido sin resolver" on public.solicitudes_comercio;
create policy "el comercio borra su pedido sin resolver"
  on public.solicitudes_comercio for delete
  to authenticated
  using (client_id in (select public.mis_comercios()) and estado = 'pendiente');

-- La oficina resuelve.
drop policy if exists "la oficina resuelve las solicitudes" on public.solicitudes_comercio;
create policy "la oficina resuelve las solicitudes"
  on public.solicitudes_comercio for update
  to authenticated
  using (public.es_admin())
  with check (public.es_admin());


-- ------------------------------------------------- 3. aprobar, de una vez
--
--  Aprobar son DOS cosas: copiar los datos a la ficha y marcar el pedido como
--  resuelto. Hechas por separado desde el navegador, se puede quedar a mitad
--  de camino —se copian los datos y falla el marcado, o al revés— y ahí queda
--  un pedido que dice "pendiente" con los datos ya aplicados, o una ficha
--  vieja con el pedido cerrado. Las dos cosas juntas o ninguna.
--
--  SÓLO SE PISA LO QUE VINO ESCRITO. Un campo vacío en el pedido no es "poner
--  vacío", es "no lo cambio": el comercio completa lo que quiere cambiar y no
--  tiene por qué volver a escribir el resto.

create or replace function public.aprobar_solicitud_comercio(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.solicitudes_comercio;
begin
  if not public.es_admin() then
    raise exception 'Sólo la oficina puede aprobar un pedido';
  end if;

  select * into s from public.solicitudes_comercio where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'Ese pedido no existe o ya se resolvió';
  end if;

  update public.clients
     set phone          = coalesce(nullif(btrim(s.phone), ''), phone),
         pickup_address = coalesce(nullif(btrim(s.pickup_address), ''), pickup_address),
         pickup_extra   = coalesce(nullif(btrim(s.pickup_extra), ''), pickup_extra),
         pickup_notes   = coalesce(nullif(btrim(s.pickup_notes), ''), pickup_notes),
         pickup_window  = coalesce(nullif(btrim(s.pickup_window), ''), pickup_window),
         /*
          * SI CAMBIÓ LA DIRECCIÓN, EL PUNTO DEL MAPA DEJA DE VALER.
          *
          * Es el detalle que puede hacer daño en silencio: la ficha quedaría
          * con la dirección nueva y el punto viejo, y el mapa mandaría al
          * repartidor a la cuadra de antes con la dirección correcta escrita
          * al lado. Se borra el punto y el comercio aparece "sin ubicar", que
          * es un cartel que se ve y se arregla en dos toques.
          */
         lat = case when nullif(btrim(s.pickup_address), '') is not null
                     and btrim(s.pickup_address) is distinct from btrim(coalesce(pickup_address, ''))
                    then null else lat end,
         lng = case when nullif(btrim(s.pickup_address), '') is not null
                     and btrim(s.pickup_address) is distinct from btrim(coalesce(pickup_address, ''))
                    then null else lng end
   where id = s.client_id;

  update public.solicitudes_comercio
     set estado = 'aprobada', resuelta_at = now(), resuelta_por = auth.uid()
   where id = p_id;
end;
$$;

grant execute on function public.aprobar_solicitud_comercio(bigint) to authenticated;


-- ---------------------------------------------------------------- comprobación
--
--  1. La tabla y sus políticas, que tienen que ser cuatro:
--
--     select policyname, cmd from pg_policies
--      where tablename = 'solicitudes_comercio' order by cmd;
--
--  2. Los pedidos que esperan:
--
--     select s.id, c.name, s.pickup_address, s.phone, s.creada_at
--       from public.solicitudes_comercio s
--       join public.clients c on c.id = s.client_id
--      where s.estado = 'pendiente' order by s.creada_at;
--
--  3. Como vos (admin) esto tiene que dar 0 filas y NO error: no sos comercio,
--     así que no tenés pedidos propios, pero sí podés ver los de todos.
--
--     select count(*) from public.solicitudes_comercio;
