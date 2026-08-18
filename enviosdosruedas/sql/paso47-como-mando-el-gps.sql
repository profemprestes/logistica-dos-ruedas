-- ============================================================================
--  PASO 47 — Saber si el teléfono está estrangulando el GPS
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  EL PROBLEMA. El ahorro de batería de Android mata los servicios en segundo
--  plano, y ahí el repartidor desaparece del mapa sin que nadie se entere. Pero
--  el ajuste no se puede leer desde la app: es nativo, y consultarlo sería una
--  APK nueva. Y encima no alcanzaría — Xiaomi, Motorola y Samsung tienen su
--  propia capa de matar apps además de la de Android, así que un teléfono puede
--  decir "sin restricciones" y matarla igual.
--
--  ASÍ QUE SE MIDE EL EFECTO, NO EL AJUSTE. El estrangulamiento no se nota en
--  un cartel: se nota en huecos. Dos números por repartidor y por día —cuántas
--  señales mandó y cuál fue el silencio más largo— dicen más que cualquier
--  pantalla de configuración. Si mañana uno aparece con un hueco de 90 minutos
--  y el otro con 2, el problema es ese teléfono y no el sistema.
--
--  Y LA BATERÍA, que es la mitad de la respuesta: si los silencios caen siempre
--  con la batería baja, el ahorro se prendió solo. Eso el teléfono sí lo puede
--  leer sin tocar la APK.
--
--  LO QUE ESTO NO ES, Y NO PUEDE SER. No es un historial de recorridos. La
--  política de privacidad publicada dice que las posiciones se borran solas a
--  las tres horas, y eso tiene que seguir siendo verdad. Acá se guardan SÓLO
--  NÚMEROS —cuántas, qué hueco, qué batería— nunca por dónde anduvo. Por eso
--  esta tabla no tiene ni lat ni lng, y no las va a tener.
-- ============================================================================

-- ------------------------------------------------------- 1. la batería
--
--  Dos columnas al lado de la posición. `null` cuando el teléfono no lo sabe:
--  no todos los navegadores lo dan, y eso no puede impedir guardar el punto.

alter table public.driver_positions
  add column if not exists bateria_pct smallint,
  add column if not exists cargando    boolean;

comment on column public.driver_positions.bateria_pct is
  'Batería del teléfono al tomar la posición, 0-100. Null si no se pudo leer.';


-- ------------------------------------------------- 2. el resumen del día
--
--  Una fila por repartidor y por día. Se llena sola con cada posición: sin
--  tarea programada y sin nada que recordar correr.

create table if not exists public.senal_dia (
  driver_id     uuid not null references public.profiles(id) on delete cascade,
  fecha         date not null default public.fecha_local(),

  posiciones    integer not null default 0,
  primera_at    timestamptz,
  ultima_at     timestamptz,

  /*
   * El silencio más largo de la jornada, en segundos.
   *
   * Sólo cuenta DENTRO de una misma conexión: si se desconectó al mediodía y
   * volvió a las cuatro, esas cuatro horas no son un hueco, son que no estaba
   * trabajando. Medirlas como falla sería inventar un problema.
   */
  hueco_max_seg integer not null default 0,
  hueco_max_at  timestamptz,

  /** La batería más baja que se vio en el día: con qué llegó al final. */
  bateria_min   smallint,

  primary key (driver_id, fecha)
);

comment on table public.senal_dia is
  'Cómo mandó el GPS cada repartidor cada día. SÓLO NÚMEROS: ni lat ni lng. '
  'Sirve para detectar teléfonos que matan la app en segundo plano (paso 47).';


-- ------------------------------------------------------- 3. quién lo ve
--
--  El repartidor ve lo suyo —es su teléfono y su jornada— y el admin ve todo.
--  Nadie escribe a mano: lo llena la función de abajo.

alter table public.senal_dia enable row level security;

drop policy if exists "cada uno ve su senal" on public.senal_dia;
create policy "cada uno ve su senal"
  on public.senal_dia for select
  to authenticated
  using (driver_id = auth.uid() or public.es_admin());


-- --------------------------------------- 4. registrar_posicion, ampliada
--
--  Los dos parámetros nuevos van con `default null`, así que lo que ya está
--  publicado sigue llamándola igual y sigue andando mientras se actualiza.

create or replace function public.registrar_posicion(
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null,
  p_bateria    smallint         default null,
  p_cargando   boolean          default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_previa   timestamptz;
  v_desde    timestamptz;
  v_hueco    integer := 0;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  -- Coordenadas imposibles: casi siempre un GPS que devolvió cualquier cosa.
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    return false;
  end if;

  -- La regla, y vive acá y no en la app a propósito: si mañana alguien llama a
  -- esta función desde otro lado, la regla sigue valiendo.
  if not public.esta_conectado(auth.uid()) then
    return false;
  end if;

  /*
   * El hueco se mide ANTES de insertar: es contra la posición anterior.
   *
   * Y sólo dentro de la conexión actual (`conectado_desde`), porque un corte
   * entre dos jornadas no es una falla del teléfono.
   */
  select conectado_desde into v_desde from public.profiles where id = auth.uid();

  select max(taken_at) into v_previa
    from public.driver_positions
   where driver_id = auth.uid()
     and taken_at >= v_desde;

  if v_previa is not null then
    v_hueco := greatest(0, extract(epoch from (now() - v_previa))::integer);
  end if;

  insert into public.driver_positions (driver_id, lat, lng, accuracy_m, bateria_pct, cargando)
  values (auth.uid(), p_lat, p_lng, p_accuracy_m, p_bateria, p_cargando);

  /*
   * El resumen del día, al toque.
   *
   * `greatest` para el hueco y `least` para la batería: los dos se quedan con
   * lo peor que pasó en el día, que es lo que hay que mirar.
   */
  insert into public.senal_dia as s
    (driver_id, fecha, posiciones, primera_at, ultima_at, hueco_max_seg, hueco_max_at, bateria_min)
  values
    (auth.uid(), public.fecha_local(), 1, now(), now(), v_hueco,
     case when v_hueco > 0 then now() end, p_bateria)
  on conflict (driver_id, fecha) do update set
    posiciones    = s.posiciones + 1,
    ultima_at     = now(),
    hueco_max_seg = greatest(s.hueco_max_seg, excluded.hueco_max_seg),
    hueco_max_at  = case
                      when excluded.hueco_max_seg > s.hueco_max_seg then now()
                      else s.hueco_max_at
                    end,
    bateria_min   = least(coalesce(s.bateria_min, 100), coalesce(p_bateria, 100));

  -- Se barren las viejas de TODOS y no sólo las de quien llama: las de alguien
  -- que dejó de mandar quedaban ahí para siempre (ver paso 25).
  delete from public.driver_positions
   where taken_at < now() - interval '3 hours';

  return true;
end;
$$;

revoke execute on function
  public.registrar_posicion(double precision, double precision, double precision, smallint, boolean)
  from public, anon;

grant execute on function
  public.registrar_posicion(double precision, double precision, double precision, smallint, boolean)
  to authenticated;

-- La vieja de tres parámetros se borra: si queda, PostgREST puede elegirla y
-- la batería y el resumen no se guardarían nunca, sin dar ningún error.
drop function if exists public.registrar_posicion(double precision, double precision, double precision);


-- ---------------------------------------------------------------- comprobación
--
--  Al rato de que un repartidor esté conectado y mandando:
--
--    select p.full_name, d.posiciones, d.hueco_max_seg / 60 as hueco_min,
--           d.bateria_min, d.primera_at, d.ultima_at
--      from public.senal_dia d
--      join public.profiles p on p.id = d.driver_id
--     where d.fecha = public.fecha_local();
