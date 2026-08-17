-- ============================================================================
--  PASO 42 — Que el repartidor vea QUÉ tiene que retirar
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  EL PROBLEMA. La colecta le dice "Independencia 2684, 4 paquetes" y hasta ahí
--  llega. Cuando entra al comercio tiene que preguntar cuáles son los suyos, y
--  el del mostrador tiene que ponerse a buscar. Eso es tiempo parado en un
--  local, que es exactamente lo que la colecta venía a evitar.
--
--  POR QUÉ NO ALCANZABA CON PEDIRLOS DESDE LA APP. Porque los permisos de la
--  base no lo dejan ver un envío que todavía no escaneó — y está bien que sea
--  así: lo que no escaneó no es suyo. Pero entonces la app pedía la lista y la
--  base le contestaba vacío, sin error y sin nada. Se veía igual que "no hay
--  paquetes".
--
--  LA SALIDA es esta función, que corre con permisos propios y devuelve UNA
--  SOLA COSA: la dirección de entrega. Ni destinatario, ni teléfono, ni plata a
--  cobrar. Con eso sabe cuáles son sus paquetes y para qué lado van, que es lo
--  que necesita para no perder tiempo; el resto lo ve recién cuando escanea y
--  el envío pasa a ser suyo de verdad.
--
--  Y SÓLO LOS PREASIGNADOS A ÉL. Los que no tienen dueño no se listan: se los
--  puede llevar cualquiera, y prometerle un paquete que capaz ya no está es
--  peor que no decirle nada.
-- ============================================================================

create or replace function public.paquetes_de_colecta(p_direccion text)
returns table (destino text)
language sql
security definer
set search_path = public
stable
as $$
  select s.address_street
    from public.shipments s
   where s.preasignado_a = auth.uid()
     and s.assigned_driver is null
     and s.status in ('creado', 'pendiente_retiro')
     /*
      * La dirección se compara sin mayúsculas ni espacios de más.
      *
      * Hace falta porque las dos puntas se escriben distinto: la colecta
      * guarda lo que se escribió al mandarla y el envío lo que se escribió al
      * cargarlo. "Independencia 2684" y "INDEPENDENCIA 2684 " son el mismo
      * lugar y tienen que cruzarse igual.
      */
     and lower(btrim(coalesce(s.pickup_address, ''))) = lower(btrim(p_direccion))
   order by s.id
   limit 40;
$$;

comment on function public.paquetes_de_colecta(text) is
  'Direcciones de entrega de los envíos preasignados al que pregunta y todavía '
  'sin retirar en ese comercio. Sólo la dirección: lo demás recién cuando escanea.';

grant execute on function public.paquetes_de_colecta(text) to authenticated;

-- ---------------------------------------------------------------- comprobación
--
-- Corré esto como vos (admin) y tiene que dar CERO filas: no tenés envíos
-- preasignados. Que dé cero es la prueba de que la función mira quién pregunta
-- y no devuelve los paquetes de otro.
--
--   select * from public.paquetes_de_colecta('INDEPENDENCIA 2684');
