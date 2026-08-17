-- ============================================================================
--  PASO 45 — El repartidor ve sólo los comercios a los que tiene que ir
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  OJO CON EL PROYECTO: va en xaxxqrxsungfuggeapuz, el de la empresa.
--
--  EL PROBLEMA. El paso 40 dejó los comercios visibles para cualquiera con
--  sesión, y era de más: un repartidor podía leer la lista entera de la
--  empresa, con teléfonos, direcciones y notas de comercios con los que no
--  tiene nada que ver. Eso es la cartera de clientes.
--
--  LO QUE SÍ NECESITA. El mapa del repartidor trae el comercio pegado al envío
--  —`comercio:client_id(name, lat, lng)`— y de ahí saca el PUNTO DE RETIRO, que
--  el envío no tiene. Sin eso el mapa vuelve a dibujar el paquete sin retirar en
--  la casa del cliente y el "cómo llegar" lo manda para el otro lado. O sea que
--  cerrarlo del todo rompe algo que costó arreglar.
--
--  LA REGLA, ENTONCES: ve un comercio si tiene un envío suyo de ese comercio.
--  Asignado o preasignado, que son las dos formas de "tenés que ir". Ni uno
--  más. El día que deja de tener envíos de ese comercio, deja de verlo.
--
--  El admin sigue viendo todo, que para eso es la oficina.
-- ============================================================================

drop policy if exists "los comercios los ve cualquiera con sesión" on public.clients;
drop policy if exists "el repartidor ve los comercios a los que va" on public.clients;

create policy "el repartidor ve los comercios a los que va"
  on public.clients for select
  to authenticated
  using (
    public.es_admin()
    or exists (
      select 1
        from public.shipments s
       where s.client_id = clients.id
         and (s.assigned_driver = auth.uid() or s.preasignado_a = auth.uid())
    )
  );

-- La de escritura del paso 40 se deja como está: los comercios los carga y los
-- corrige la oficina, y el repartidor no los toca.

-- Un índice para que la comprobación de arriba no cueste: se ejecuta una vez
-- por comercio en cada dibujo del mapa.
create index if not exists shipments_client_asignado_idx
  on public.shipments (client_id, assigned_driver);

-- ---------------------------------------------------------------- comprobación
--
-- Como vos (admin) tienen que salir los 14. Con la cuenta de un repartidor,
-- sólo los de sus envíos:
--
--   select id, name from public.clients order by name;
