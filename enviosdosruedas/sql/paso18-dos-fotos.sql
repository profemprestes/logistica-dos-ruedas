-- ============================================================================
--  PASO 18 — Hasta dos fotos por entrega, y los FLEX también sacan foto
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  CORRELO ANTES DE DESPLEGAR EL CÓDIGO. La app nueva llama a resolve_delivery
--  con un parámetro más (`p_photo_path_2`); si la función todavía no lo tiene,
--  PostgREST contesta "Could not find the function" y los repartidores no
--  pueden cerrar ninguna entrega. Con este paso corrido, en cambio, la app
--  vieja sigue funcionando igual: el parámetro nuevo tiene default.
--
--  Dos cambios:
--
--  1. `photo_path_2`: una segunda foto opcional. Hay entregas donde una sola
--     no alcanza —el paquete y la fachada, o el paquete y el remito— y hasta
--     ahora el repartidor tenía que elegir cuál guardaba.
--
--  2. Los FLEX entregados pasan a llevar foto obligatoria (eso es del lado de
--     la app, acá no hay nada que forzar). Antes se cerraban sólo con hora y
--     ubicación porque la constancia la genera Mercado Libre; el problema es
--     que esa constancia es de ellos, y cuando el comercio reclama de nuestro
--     lado no queda nada para mostrar.
--
--  ¿Por qué una columna y no un arreglo de rutas? Porque el tope es dos y no
--  se ve que vaya a crecer: cada foto se sube desde la calle con la señal que
--  haya. Una columna más se lee de un vistazo en el editor de Supabase; un
--  `text[]` obligaría a tocar todas las consultas para ganar nada.
-- ============================================================================

alter table public.delivery_logs
  add column if not exists photo_path_2 text;

comment on column public.delivery_logs.photo_path_2 is
  'Segunda foto del comprobante, opcional. La primera es photo_path.';


-- ------------------------------------------------ resolve_delivery, versión 18
--
--  Es la del paso 16 (con `p_comment` y el `synced_offline` arreglado) más el
--  parámetro nuevo al final. Si tocaste la función a mano en Supabase,
--  comparala antes de correr esto.
--
--  El `drop` de la firma anterior NO es opcional: si quedan las dos, una
--  llamada con los 12 parámetros de antes encaja en ambas y Postgres corta con
--  "could not choose the best candidate function".

drop function if exists public.resolve_delivery(
  uuid, bigint, text, timestamptz, text, text, text,
  double precision, double precision, double precision, text, text
);

create or replace function public.resolve_delivery(
  p_client_event_id uuid,
  p_shipment_id     bigint,
  p_kind            text,
  p_happened_at     timestamptz,
  p_reason          text             default null,
  p_receiver_name   text             default null,
  p_receiver_dni    text             default null,
  p_lat             double precision default null,
  p_lng             double precision default null,
  p_accuracy_m      double precision default null,
  p_photo_path      text             default null,
  p_comment         text             default null,
  p_photo_path_2    text             default null
)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shipment public.shipments;
  v_rows     integer;
  v_cobra    numeric := 0;
  v_reason   text;
  v_offline  boolean;
begin
  if auth.uid() is null then
    raise exception 'SIN_SESION';
  end if;

  if p_kind not in ('entregado', 'no_entregado') then
    raise exception 'TIPO_INVALIDO: %', p_kind;
  end if;

  select * into v_shipment from public.shipments where id = p_shipment_id;

  if v_shipment.id is null then
    raise exception 'ENVIO_NO_ENCONTRADO';
  end if;

  if v_shipment.assigned_driver is distinct from auth.uid() then
    raise exception 'ENVIO_DE_OTRO';
  end if;

  -- Un paquete que nunca se retiró no se puede haber entregado. Sin esto el
  -- seguimiento del cliente salta de "registrado" a "entregado" sin el medio.
  if v_shipment.status in ('creado', 'pendiente_retiro') then
    raise exception 'FALTA_RETIRAR';
  end if;

  -- No lo dice el celular, lo dice el reloj: si la entrega llega más de dos
  -- minutos después de haber ocurrido, estuvo esperando en la cola del teléfono.
  v_offline := p_happened_at < now() - interval '2 minutes';

  -- Normaliza el motivo al enum: "Dirección incorrecta" -> direccion_incorrecta
  v_reason := lower(trim(coalesce(p_reason, '')));
  v_reason := translate(v_reason, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
  v_reason := replace(v_reason, ' ', '_');

  if v_reason not in ('ausente', 'intransitable', 'direccion_incorrecta',
                      'telefono_incorrecto', 'rechazado', 'otro') then
    v_reason := 'otro';
  end if;

  if p_kind = 'entregado' and v_shipment.payment_mode = 'cobrar_destinatario' then
    v_cobra := coalesce(v_shipment.amount_to_collect, 0);
  end if;

  insert into public.delivery_logs (
    client_event_id, client_uuid, shipment_id, driver_id,
    event, failure_reason,
    receiver_name, receiver_dni, lat, lng, gps_accuracy,
    photo_path, photo_path_2,
    comment,
    amount_collected, happened_at, synced_offline
  )
  values (
    p_client_event_id, p_client_event_id, p_shipment_id, auth.uid(),
    p_kind::public.delivery_event,
    case when p_kind = 'no_entregado' then v_reason::public.failure_reason end,
    p_receiver_name, p_receiver_dni, p_lat, p_lng, p_accuracy_m,
    p_photo_path, p_photo_path_2,
    nullif(trim(coalesce(p_comment, '')), ''),
    v_cobra, p_happened_at, v_offline
  )
  on conflict (client_event_id) where client_event_id is not null do nothing;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return v_shipment;   -- evento repetido: el estado ya se movió
  end if;

  update public.shipments
     set status = (case when p_kind = 'entregado' then 'entregado' else 'pendiente_entrega' end)
                  ::public.shipment_status,

         delivered_at = case when p_kind = 'entregado' then p_happened_at
                             else delivered_at end,

         last_failure_reason = case when p_kind = 'entregado' then last_failure_reason
                                    else v_reason::public.failure_reason end,

         attempts = case when p_kind = 'entregado' then attempts
                         else coalesce(attempts, 0) + 1 end
   where id = p_shipment_id
   returning * into v_shipment;

  return v_shipment;
end;
$$;

-- El anónimo no la ejecuta (paso 17): sólo quien tiene sesión.
revoke execute on function public.resolve_delivery(
  uuid, bigint, text, timestamptz, text, text, text,
  double precision, double precision, double precision, text, text, text
) from public, anon;

grant execute on function public.resolve_delivery(
  uuid, bigint, text, timestamptz, text, text, text,
  double precision, double precision, double precision, text, text, text
) to authenticated;


-- ------------------------------------------------------------------ control
--
--  Después de correrlo, esto tiene que devolver UNA sola fila, con 13
--  argumentos. Si devuelve dos, quedó la versión vieja dando vueltas y las
--  entregas van a fallar con "could not choose the best candidate function".
--
--    select p.oid::regprocedure as firma, p.pronargs as argumentos
--      from pg_proc p
--      join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public' and p.proname = 'resolve_delivery';
--
--  El bucket de fotos no necesita ningún cambio: la segunda foto va a la misma
--  carpeta del envío (`<id>/<evento>-2.jpg`) y las políticas del paso 4 son por
--  bucket, no por nombre de archivo.
