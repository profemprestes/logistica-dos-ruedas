import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import Logo from '@/components/Logo';
import SiteFooter, { WHATSAPP } from '@/components/SiteFooter';

/**
 * Política de privacidad.
 *
 * La pide Google para sacar a la app del cartel de "aplicación peligrosa", pero
 * eso es la excusa: lo que dice acá es lo que el sistema hace de verdad, y se
 * escribió leyendo el código, no copiando un modelo. Cada afirmación se puede
 * comprobar contra la base — el borrado de las posiciones a las tres horas está
 * en `sql/paso37-conectarse.sql`, el depósito privado de las fotos en
 * `lib/proof.ts`, y así con el resto.
 *
 * POR QUÉ IMPORTA QUE SEA CIERTA. Una política copiada promete cosas que el
 * sistema no cumple y calla las que sí hace. La que más importa acá es la
 * ubicación en segundo plano: es lo que Google mira con lupa y lo que a un
 * repartidor le da derecho a preguntar. Está dicha de frente y con su límite.
 *
 * Va sin sesión a propósito: una política que hay que loguearse para leer no
 * sirve ni para Google ni para nadie.
 */

export const metadata: Metadata = {
  title: 'Política de privacidad · Envíos DosRuedas',
  description:
    'Qué datos toma el sistema de Envíos DosRuedas, para qué, con quién se comparten y cuánto tiempo se guardan.',
};

/** La fecha en que se escribió. A mano: cambiarla es parte de cambiar el texto. */
const ACTUALIZADA = '17 de agosto de 2026';

const h2 = 'font-anton text-xl uppercase tracking-[-.01em] text-[var(--edr-yellow)] mt-9 mb-2.5';
const h3 = 'font-bebas text-base tracking-[.06em] text-white mt-5 mb-1.5';
const parrafo = 'text-[15px] leading-relaxed text-[var(--edr-muted)]';
const item = 'text-[15px] leading-relaxed text-[var(--edr-muted)] pl-1';

export default function Privacidad() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-[var(--edr-border)]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-5 py-4">
          <Link href="/" className="flex items-center gap-3">
            <Logo size={40} />
            <span className="font-anton text-lg uppercase leading-[.9] tracking-[-.01em] text-white">
              Envíos<span className="text-[var(--edr-yellow)]">DosRuedas</span>
            </span>
          </Link>

          <a
            href="https://www.enviosdosruedas.com"
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-1.5 rounded-full border border-[var(--edr-border)] px-4 py-2 font-bebas text-sm tracking-[.06em] text-[var(--edr-muted)] transition hover:bg-[var(--edr-surface)] hover:text-[var(--edr-yellow)]"
          >
            IR A LA WEB
            <ArrowUpRight size={14} strokeWidth={2.5} />
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
        <h1 className="font-anton text-3xl uppercase leading-none tracking-[-.02em] text-white sm:text-4xl">
          Política de privacidad
        </h1>
        <p className="mt-2 text-sm text-[var(--edr-muted)]">Última actualización: {ACTUALIZADA}</p>

        <p className={`${parrafo} mt-6`}>
          Este documento explica qué datos toma el sistema de Envíos DosRuedas, para qué se usan,
          con quién se comparten y cuánto tiempo se guardan. Está escrito para que lo entienda
          cualquiera, sin vueltas.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Quiénes somos</h2>
        <p className={parrafo}>
          <strong className="text-white">Envíos DosRuedas</strong> es una empresa de mensajería y
          logística de última milla de Mar del Plata, provincia de Buenos Aires, Argentina.
        </p>
        <p className={`${parrafo} mt-3`}>
          Nuestro sitio comercial —donde se cotiza y se contrata— es{' '}
          <a
            href="https://www.enviosdosruedas.com"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--edr-yellow)] underline underline-offset-2"
          >
            www.enviosdosruedas.com
          </a>
          . Este sitio, <strong className="text-white">www.logisticadosruedas.com</strong>, es el
          sistema con el que operamos: acá se cargan los envíos, se sigue un paquete y trabajan
          nuestros repartidores. Los dos dominios pertenecen a la misma empresa, y la aplicación
          para Android es este mismo sistema puesto adentro de una app.
        </p>
        <p className={`${parrafo} mt-3`}>
          Responsable de los datos: <strong className="text-white">Matías Cejas</strong>. Para
          cualquier consulta sobre esta política escribinos a{' '}
          <a
            href="mailto:MatiasCejas@enviosdosruedas.com"
            className="text-[var(--edr-yellow)] underline underline-offset-2"
          >
            MatiasCejas@enviosdosruedas.com
          </a>{' '}
          o por WhatsApp al{' '}
          <a
            href={`https://wa.me/${WHATSAPP}`}
            target="_blank"
            rel="noreferrer"
            className="text-[var(--edr-yellow)] underline underline-offset-2"
          >
            2236602699
          </a>
          .
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Qué es esta aplicación</h2>
        <p className={parrafo}>
          Es una <strong className="text-white">herramienta de trabajo interna</strong>. No se
          descarga de una tienda ni se ofrece al público: la usan únicamente los repartidores de la
          empresa, con un usuario y una contraseña que les damos nosotros. No hay registro abierto
          ni forma de crearse una cuenta.
        </p>
        <p className={`${parrafo} mt-3`}>
          Por el sistema pasan datos de tres grupos de personas:
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li className={item}>
            <strong className="text-white">Repartidores</strong>: quienes trabajan con nosotros y
            usan la app.
          </li>
          <li className={item}>
            <strong className="text-white">Destinatarios</strong>: quienes reciben un paquete.
          </li>
          <li className={item}>
            <strong className="text-white">Comercios</strong>: los clientes que nos contratan.
          </li>
        </ul>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Datos de los repartidores</h2>

        <h3 className={h3}>Ubicación, incluso con la app cerrada</h3>
        <p className={parrafo}>
          La app toma la <strong className="text-white">ubicación del teléfono</strong> y la manda a
          nuestro sistema mientras el repartidor está trabajando. Lo hace también{' '}
          <strong className="text-white">en segundo plano</strong>, es decir con la pantalla apagada
          o la app minimizada, porque de otro modo dejaríamos de saber dónde está el paquete apenas
          guarda el teléfono en el bolsillo.
        </p>
        <p className={`${parrafo} mt-3`}>
          Para qué la usamos: para saber por dónde va el reparto, poder contestarle a un cliente que
          pregunta cuánto falta, y organizar el día. Nada más.
        </p>
        <p className={`${parrafo} mt-3`}>Cuándo se toma, y cuándo no:</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li className={item}>
            Sólo cuando el repartidor está <strong className="text-white">conectado</strong>. Él
            mismo se conecta al empezar y se desconecta al terminar, desde un botón que tiene
            siempre a la vista.
          </li>
          <li className={item}>
            La conexión <strong className="text-white">se vence sola a las 2 horas</strong> sin
            actividad. Si se olvida de desconectarse, el sistema lo desconecta por él.
          </li>
          <li className={item}>
            Desconectado, la app <strong className="text-white">no toma ubicación</strong>. Fuera
            del horario de trabajo no sabemos dónde está nadie, y no queremos saberlo.
          </li>
        </ul>
        <p className={`${parrafo} mt-3`}>
          Cuánto se guarda:{' '}
          <strong className="text-white">las posiciones se borran solas a las 3 horas</strong>. No
          armamos un historial de recorridos ni guardamos por dónde anduvo alguien la semana
          pasada: esa información no nos sirve para nada y no la conservamos.
        </p>

        <h3 className={h3}>Fotos y comentarios de la entrega</h3>
        <p className={parrafo}>
          Al cerrar una entrega, el repartidor saca una foto del paquete entregado y puede escribir
          un comentario. Es el comprobante de que el envío llegó. Las fotos se guardan en un{' '}
          <strong className="text-white">depósito privado</strong>: no tienen dirección pública, y
          para verlas hay que estar dentro del sistema, con un enlace temporal que vence solo.
        </p>

        <h3 className={h3}>Notificaciones</h3>
        <p className={parrafo}>
          Para avisarle al repartidor que tiene un envío nuevo o que debe pasar a retirar por un
          comercio, guardamos un{' '}
          <strong className="text-white">identificador de notificaciones del dispositivo</strong>{' '}
          que provee Google. No es el número de teléfono ni identifica a la persona fuera de nuestro
          sistema, y sirve sólo para mandarle avisos de trabajo.
        </p>

        <h3 className={h3}>Cuenta y liquidaciones</h3>
        <p className={parrafo}>
          Guardamos el nombre, el usuario, los movimientos de cada entrega y la liquidación de lo
          cobrado, que es lo necesario para pagarle y para cerrar la caja del día.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Datos de los destinatarios</h2>
        <p className={parrafo}>
          De quien recibe un paquete guardamos{' '}
          <strong className="text-white">nombre, teléfono, dirección de entrega</strong> y, si
          corresponde, el monto a cobrar contra entrega. Estos datos no los pedimos nosotros: nos
          los da el comercio que nos contrata para hacer el envío, y los usamos únicamente para
          entregarlo y para poder avisar o coordinar si hace falta.
        </p>
        <p className={`${parrafo} mt-3`}>
          Con el código de seguimiento (EDR…) se puede consultar el estado de un envío sin entrar al
          sistema. Esa consulta muestra el estado y el comprobante, y está pensada para que el
          destinatario y el comercio sepan qué pasó con el paquete.
        </p>
        <p className={`${parrafo} mt-3`}>
          Los envíos entregados se conservan como registro de la operación: es el respaldo ante un
          reclamo y parte de lo que le debemos al comercio que nos contrató. Si sos destinatario y
          querés que borremos tus datos, escribinos y lo resolvemos.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Datos de los comercios</h2>
        <p className={parrafo}>
          Nombre, teléfono, dirección de retiro y sus coordenadas, para que el repartidor sepa a
          dónde pasar a buscar los paquetes. Un repartidor{' '}
          <strong className="text-white">
            sólo ve los comercios de los que tiene un envío asignado
          </strong>
          : no puede ver la lista de clientes de la empresa.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Con quién se comparten</h2>
        <p className={parrafo}>
          No vendemos datos, no los cedemos a terceros y no hacemos publicidad con ellos. Los únicos
          que intervienen son los servicios que hacen funcionar el sistema:
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li className={item}>
            <strong className="text-white">Supabase</strong> — guarda la base de datos y las fotos
            de entrega.
          </li>
          <li className={item}>
            <strong className="text-white">Vercel</strong> — publica el sitio.
          </li>
          <li className={item}>
            <strong className="text-white">Google (Firebase Cloud Messaging)</strong> — entrega las
            notificaciones a los teléfonos de los repartidores.
          </li>
          <li className={item}>
            <strong className="text-white">OpenStreetMap</strong> — dibuja los mapas y convierte una
            dirección escrita en un punto. Se le manda la dirección a buscar, no datos de personas.
          </li>
        </ul>
        <p className={`${parrafo} mt-3`}>
          Estos servicios pueden alojar la información en servidores fuera de la Argentina. También
          podemos entregar datos si nos lo requiere una autoridad competente.
        </p>
        <p className={`${parrafo} mt-3`}>
          <strong className="text-white">No usamos</strong> herramientas de analítica, cookies de
          seguimiento, píxeles publicitarios ni redes de anuncios. El sistema no te sigue por otros
          sitios.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Cómo cuidamos la información</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li className={item}>Todo viaja cifrado (HTTPS).</li>
          <li className={item}>
            Cada persona ve sólo lo suyo: la base tiene reglas que impiden que un repartidor lea los
            envíos, la ubicación o la liquidación de otro, aunque quisiera.
          </li>
          <li className={item}>Las fotos están en un depósito privado, con enlaces que vencen.</li>
          <li className={item}>Hacemos copias de seguridad diarias de la base.</li>
        </ul>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Tus derechos</h2>
        <p className={parrafo}>
          Podés pedirnos acceder a tus datos, corregirlos si están mal, o que los borremos.
          Escribinos a{' '}
          <a
            href="mailto:MatiasCejas@enviosdosruedas.com"
            className="text-[var(--edr-yellow)] underline underline-offset-2"
          >
            MatiasCejas@enviosdosruedas.com
          </a>{' '}
          y te respondemos. Si sos repartidor y dejás de trabajar con nosotros, damos de baja tu
          cuenta y tu identificador de notificaciones.
        </p>
        <p className={`${parrafo} mt-3 text-[13.5px]`}>
          El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los
          mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un
          interés legítimo al efecto, conforme lo establecido en el artículo 14, inciso 3 de la Ley
          N.º 25.326.
        </p>
        <p className={`${parrafo} mt-3 text-[13.5px]`}>
          La Agencia de Acceso a la Información Pública, en su carácter de órgano de control de la
          Ley N.º 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan
          quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en
          materia de protección de datos personales.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Menores de edad</h2>
        <p className={parrafo}>
          El sistema no está dirigido a menores de 18 años ni les pedimos datos. Las cuentas son de
          personas que trabajan con nosotros.
        </p>

        {/* ---------------------------------------------------------------- */}
        <h2 className={h2}>Cambios</h2>
        <p className={parrafo}>
          Si cambiamos algo de esta política, actualizamos la fecha de arriba. Si el cambio afecta a
          los repartidores —por ejemplo, si algún día tomáramos datos nuevos— se lo avisamos
          directamente, además de publicarlo acá.
        </p>
      </main>

      <footer className="border-t border-[var(--edr-border)] px-5 py-8">
        <div className="mx-auto max-w-3xl">
          <SiteFooter />
        </div>
      </footer>
    </div>
  );
}
