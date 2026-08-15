-- ============================================================================
--  PASO 36 — Borrar la isla vieja
--  Pegá TODO en Supabase → SQL Editor → Run. Se puede correr más de una vez.
--
--  QUÉ ES LA ISLA. Adentro de la base vivían tres objetos de un diseño
--  anterior, con nombres en castellano, de antes de que el sistema usara
--  `profiles`, `settlements` y `delivery_logs`:
--
--      repartidores          movimientos_caja          saldos_repartidores
--
--  Ningún archivo del proyecto los menciona: se hicieron a mano en Supabase y
--  quedaron ahí. Los aviso de seguridad de Supabase los encontró el 15/08/2026.
--
--  POR QUÉ NO ERA SÓLO DESPROLIJIDAD. Los tres tenían otorgados TODOS los
--  permisos a `anon` y a `authenticated`: select, insert, update, delete y
--  truncate. `anon` es la llave que viaja adentro del JavaScript del sitio, o
--  sea que la tiene cualquiera que abra la página y mire el código.
--
--  Y `saldos_repartidores` era además una vista SECURITY DEFINER: corría con
--  los permisos de quien la creó (`postgres`, que ve todo) y no con los de
--  quien pregunta, así que ninguna regla de permisos la frenaba.
--
--  Lo único que las mantenía tapadas era que no estaban publicadas en la API
--  —se probó con la llave anónima, con sesión de repartidor y con la de
--  servicio, y las tres fallaban—. ESO NO ERA UNA DEFENSA: nunca se entendió
--  por qué no estaban publicadas, y la API republica todo cada vez que cambia
--  el esquema. Correr cualquier paso nuevo podía abrirlas.
--
--  POR QUÉ BORRAR Y NO CERRAR. Porque están VACÍAS: cero filas las dos, mirado
--  antes de escribir esto. No hay historia que perder. Cerrarlas dejaba el
--  problema ahí, y a alguien dentro de un año encontrándose dos juegos de
--  tablas sin saber cuál es el que corre.
--
--  SI ESTO FALLA con un error de dependencias, PARÁ y fijate qué depende. Que
--  falle es la red de seguridad funcionando: quiere decir que algo las usa y
--  que esta lectura estaba incompleta. NO le agregues `cascade` para que pase.
-- ============================================================================

-- La vista primero: es la que depende de las tablas, no al revés.
drop view if exists public.saldos_repartidores;

drop table if exists public.movimientos_caja;
drop table if exists public.repartidores;


-- ------------------------------------------------------------------ control
--
--  1. Que no quede ninguno de los tres. Tiene que devolver CERO filas:
--
--     select table_name from information_schema.tables
--      where table_schema = 'public'
--        and table_name in ('repartidores','movimientos_caja','saldos_repartidores');
--
--  2. Que el sistema de verdad siga entero. Estas son las que importan y
--     ninguna se toca acá:
--
--     select table_name from information_schema.tables
--      where table_schema = 'public'
--        and table_name in ('shipments','profiles','settlements','delivery_logs',
--                           'driver_positions','driver_summaries','push_subscriptions');
--
--  3. En Supabase → Advisors → Security, el aviso `security_definer_view` tiene
--     que desaparecer. Puede tardar un rato: ese informe se guarda en caché.
--
--  4. Y la prueba de verdad: abrir el panel y el seguimiento de un envío. Nada
--     de esto tocaba el sistema que corre, pero eso se comprueba, no se supone.
