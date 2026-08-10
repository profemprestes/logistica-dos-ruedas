-- ============================================================================
--  PASO 10 — Notificaciones push
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  Cada celular que acepta notificaciones genera una "suscripción": una URL
--  única del servicio de push (Google, Apple) más dos claves para cifrar el
--  mensaje. Sin eso guardado, no hay forma de avisarle nada al repartidor.
--
--  Un mismo repartidor puede tener varias: el celular de trabajo, el personal,
--  la compu. Se le manda a todas.
-- ============================================================================

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  driver_id  uuid not null references public.profiles(id) on delete cascade,

  -- La URL que da el navegador. Es única por celular y es la clave real.
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,

  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

create index if not exists push_subscriptions_driver_idx
  on public.push_subscriptions (driver_id);

alter table public.push_subscriptions enable row level security;

-- Cada uno maneja las suyas: las da de alta al aceptar y las borra al rechazar.
drop policy if exists "cada uno maneja sus suscripciones" on public.push_subscriptions;
create policy "cada uno maneja sus suscripciones"
  on public.push_subscriptions for all
  to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());

-- El admin las ve para poder diagnosticar por qué a alguien no le llega nada.
drop policy if exists "admin ve las suscripciones" on public.push_subscriptions;
create policy "admin ve las suscripciones"
  on public.push_subscriptions for select
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
