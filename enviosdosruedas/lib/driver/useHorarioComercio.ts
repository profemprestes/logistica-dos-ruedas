'use client';

import { useEffect, useState } from 'react';
import { horaDelDiaAR, type Shipment } from '@/lib/format';
import { estadoDelComercio, horarioDeRetiro, type EstadoComercio } from '@/lib/franja';
import { esProgramado } from '@/lib/scheduled';

/**
 * El horario del comercio donde se retira, y cómo está el local ahora.
 *
 * VIVE ACÁ porque lo preguntan las dos pantallas donde el repartidor decide si
 * ir o no ir: la tarjeta de la hoja de ruta y la ficha del envío. Es la misma
 * cuenta —qué día se retira, qué horario manda ese día, qué hora es— y con una
 * copia en cada pantalla se garantiza que un día digan cosas distintas del
 * mismo comercio, con el repartidor arriba de la moto en el medio.
 *
 * `activo` en false apaga el reloj. La hoja de ruta dibuja una tarjeta por
 * envío y la mayoría ya están retirados: sin esto, veinte envíos serían veinte
 * relojes despertando veinte tarjetas por minuto para no cambiar nada.
 */
export function useHorarioComercio(
  shipment: Shipment,
  activo = true,
): { horario: string | null; estado: EstadoComercio | null } {
  /*
   * La hora se refresca sola cada minuto.
   *
   * Sin esto, un "cierra en 20 min" calculado al dibujar la pantalla seguiría
   * diciendo lo mismo media hora después: el repartidor deja la app abierta
   * mientras carga la moto, y la cuenta que le importa es la de ahora.
   *
   * Arranca en `null` y se llena recién en el navegador, porque la hora del
   * servidor no es la del celular y mostrar una y después la otra hace
   * parpadear el cartel.
   */
  const [ahora, setAhora] = useState<Date | null>(null);

  useEffect(() => {
    if (!activo) return;

    const mirar = () => setAhora(new Date());
    mirar();
    const t = window.setInterval(mirar, 60_000);
    return () => window.clearInterval(t);
  }, [activo]);

  /*
   * Para un envío programado vale el horario del DÍA EN QUE SE RETIRA y no el
   * de hoy: un local que el sábado cierra antes tiene que decirlo el sábado, no
   * el jueves que se mira la ficha de paso.
   */
  const programado = esProgramado(shipment);
  const diaDelRetiro = programado ? new Date(`${shipment.scheduled_date}T12:00:00`) : ahora;
  const horario = diaDelRetiro ? horarioDeRetiro(shipment, diaDelRetiro) : null;

  /*
   * El abierto/cerrado es una foto de AHORA, así que en un envío programado no
   * va: decirle que el comercio está abierto un jueves, para un retiro del
   * martes que viene, es contestarle una pregunta que no hizo.
   */
  const estado =
    !programado && ahora && horario ? estadoDelComercio(horario, horaDelDiaAR(ahora)) : null;

  return { horario, estado };
}
