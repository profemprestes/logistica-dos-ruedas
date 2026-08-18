-- ============================================================================
--  PASO 48 — Horario de retiro: el del comercio, y el del envío que lo pisa
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  LO QUE FALTABA. El sistema sabía hasta qué hora hay que ENTREGAR
--  (`delivery_window`) pero no hasta qué hora se puede RETIRAR. Y es una
--  restricción distinta y muy real: si el comercio cierra a las 18, a las
--  17:40 con tres paquetes ahí sin retirar hay un problema, aunque la entrega
--  venza recién mañana. Eso hasta hoy vivía en la cabeza del que atiende.
--
--  DOS LUGARES, Y UNO MANDA SOBRE EL OTRO:
--
--    · `clients.pickup_window` es el horario del comercio. Se carga UNA VEZ en
--      la ficha y vale para todos sus envíos, los cargados a mano y los
--      pegados del WhatsApp. Es el que se usa el 99% de las veces.
--
--    · `shipments.pickup_window` es la excepción de ese envío. Cuando está,
--      gana. Sirve para el "este retiralo antes de las 12 porque el cliente lo
--      pidió" sin tener que cambiarle el horario al comercio entero.
--
--  TEXTO LIBRE, COMO LA FRANJA DE ENTREGA. Se escribe "9 a 18 hs", "hasta las
--  13", "ANTES 18HS", y lo entiende el mismo analizador que ya usa la franja de
--  entrega (`lib/franja.ts`). Ponerlo como hora exacta obligaría a la oficina a
--  traducir lo que le dijeron por WhatsApp, y esa traducción es justo donde se
--  pierden los datos.
-- ============================================================================

alter table public.clients
  add column if not exists pickup_window text;

comment on column public.clients.pickup_window is
  'Horario en que este comercio entrega los paquetes: "9 a 18 hs". Texto libre, '
  'lo interpreta lib/franja.ts. Vale para todos sus envíos salvo que el envío '
  'traiga el suyo.';

alter table public.shipments
  add column if not exists pickup_window text;

comment on column public.shipments.pickup_window is
  'La excepción de ESTE envío: cuando está, le gana al horario del comercio. '
  'Para el "retiralo antes de las 12" que no cambia el horario del local.';

-- ---------------------------------------------------------------- comprobación
--
--   select name, pickup_address, pickup_window from public.clients order by name;
--
--  Al principio van todos en null y no pasa nada: sin horario cargado, el
--  aviso de retiro simplemente no salta, igual que hasta ahora.
