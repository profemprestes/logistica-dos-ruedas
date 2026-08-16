-- ============================================================================
--  PASO 35 — Que los avisos también lleguen a la app de Android
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  POR QUÉ HACE FALTA OTRA TABLA. Las notificaciones de siempre (paso 10) viajan
--  por Web Push: el navegador entrega una URL única y dos claves de cifrado, y
--  eso vive en `push_subscriptions`.
--
--  Adentro de la app de Android eso no existe. La ventana de una app no tiene
--  Web Push —no es una limitación nuestra, no está implementado— y en su lugar
--  Android entrega otra cosa: un token de Firebase, un texto solo, sin claves.
--
--  Se podría haber metido a la fuerza en la tabla vieja rellenando `p256dh` y
--  `auth` con cualquier cosa. Son dos caminos distintos de punta a punta: el
--  servidor los manda con librerías distintas y los da de baja por errores
--  distintos. Mezclarlos se paga la primera vez que algo falla y no se entiende
--  de cuál de los dos.
--
--  Un repartidor puede estar en las dos: el celular con la app instalada y la
--  compu de la oficina con Chrome. Se le avisa por las dos y ve el aviso donde
--  esté. Repetido no queda, porque un mismo celular no puede tener las dos.
-- ============================================================================

create table if not exists public.push_tokens (
  id         bigint generated always as identity primary key,
  driver_id  uuid not null references public.profiles(id) on delete cascade,

  -- El token que da Firebase. Es único por instalación y es la clave real:
  -- si el repartidor reinstala la app, cambia.
  token      text not null unique,

  -- Para poder mirar en la tabla y entender qué es cada fila.
  device     text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

create index if not exists push_tokens_driver_idx
  on public.push_tokens (driver_id);

comment on table public.push_tokens is
  'Tokens de Firebase de la app de Android. El equivalente de push_subscriptions (paso 10), que es para navegadores.';


-- --------------------------------------------------------------------- RLS
--
--  Las mismas reglas que las suscripciones del paso 10, y por el mismo motivo:
--  cada repartidor maneja las de su propio celular, y el admin las ve para
--  poder averiguar por qué a alguien no le llega nada.
--
--  El envío no pasa por acá: lo hace el servidor con la clave de servicio, que
--  no pasa por RLS.

alter table public.push_tokens enable row level security;

drop policy if exists "cada uno maneja sus tokens" on public.push_tokens;
create policy "cada uno maneja sus tokens"
  on public.push_tokens for all
  to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

drop policy if exists "admin ve los tokens" on public.push_tokens;
create policy "admin ve los tokens"
  on public.push_tokens for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));


-- ------------------------------------------------------------------ control
--
--  1. Que la tabla esté y tenga RLS:
--
--     select tablename, rowsecurity from pg_tables
--      where schemaname = 'public' and tablename = 'push_tokens';
--
--  2. La prueba de verdad es en el celular: instalar el APK, entrar, ir a
--     Perfil y activar los avisos. Tiene que aparecer una fila:
--
--     select p.full_name, t.device, t.created_at
--       from public.push_tokens t
--       join public.profiles p on p.id = t.driver_id
--      order by t.id desc;
--
--  3. Y después, asignarle un envío desde el panel con la app CERRADA. El aviso
--     tiene que llegar igual: si sólo llega con la app abierta, el que está
--     andando es el camino viejo y no este.
