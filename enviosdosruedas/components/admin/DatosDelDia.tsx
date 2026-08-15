'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/lib/supabaseClient';
import { leerSesion } from '@/lib/role';
import { hoyLocal } from '@/lib/scheduled';
import { shipmentCash, type Shipment } from '@/lib/format';
import { buscarAtrasos, type Atraso } from '@/lib/admin/atrasos';

/**
 * Cómo viene el día, en un solo lugar.
 *
 * La barra de arriba necesita saber cuántos atrasos hay (el globito rojo) y
 * cuántos repartidores están en la calle; el Panel del día necesita todo eso y
 * más. Si cada uno consultara por su cuenta, abrir el panel serían dos
 * consultas iguales, y peor: los dos números podrían no coincidir entre sí,
 * que es la clase de detalle que hace que se deje de confiar en el tablero.
 *
 * Así que se consulta una vez acá y se reparte. Se refresca solo cada minuto
 * porque esto se deja abierto todo el día en la computadora de la oficina: un
 * tablero que hay que recargar a mano no se mira.
 */

export interface Repartidor {
  id: string;
  nombre: string;
  /** Minutos desde la última señal. `null` si nunca mandó una hoy. */
  haceMinutos: number | null;
  entregados: number;
  total: number;
  /** Plata que lleva encima ahora mismo, de lo que ya cobró. */
  lleva: number;
}

export interface DatosDelDia {
  cargando: boolean;
  /** Los envíos de hoy. */
  deHoy: Shipment[];
  /** Los no entregados que siguen sin reprogramar, de cualquier fecha. */
  colgados: Shipment[];
  atrasos: Atraso[];
  repartidores: Repartidor[];
  /** Cuántos dieron señal en la última media hora. */
  enCalle: number;
  /** Lo que hay para cobrar en la puerta hoy, de lo que todavía no se entregó. */
  aCobrar: number;
  entregados: number;
  refrescar: () => void;
}

const Contexto = createContext<DatosDelDia | null>(null);

/** Después de esto se considera que el repartidor no está mandando señal. */
const MINUTOS_EN_CALLE = 30;

const VACIO: Omit<DatosDelDia, 'refrescar'> = {
  cargando: true,
  deHoy: [],
  colgados: [],
  atrasos: [],
  repartidores: [],
  enCalle: 0,
  aCobrar: 0,
  entregados: 0,
};

async function traer(hoy: string) {
  const desdeHoy = new Date(`${hoy}T00:00:00`).toISOString();

  const [envios, pendientes, posiciones, movimientos] = await Promise.all([
    supabase
      .from('shipments')
      .select('*, driver:assigned_driver(full_name)')
      .eq('scheduled_date', hoy),
    // Los colgados no tienen fecha: justamente el problema es que quedaron
    // atrás. Se traen aparte y sin filtro de día.
    supabase
      .from('shipments')
      .select('*, driver:assigned_driver(full_name)')
      .eq('status', 'pendiente_entrega')
      .is('reprogramado_en', null)
      .limit(50),
    supabase
      .from('driver_positions')
      .select('driver_id, taken_at')
      .order('taken_at', { ascending: false })
      .limit(300),
    // El historial del día sirve para dos cosas a la vez: saber desde cuándo
    // cada envío está en camino, y —porque la app toma el GPS en cada
    // movimiento— saber que el repartidor dio señal aunque la posición
    // automática no haya llegado.
    supabase
      .from('delivery_logs')
      .select('shipment_id, driver_id, event, happened_at')
      .gte('happened_at', desdeHoy)
      .order('happened_at', { ascending: true })
      .limit(1000),
  ]);

  return {
    deHoy: (envios.data ?? []) as unknown as Shipment[],
    colgados: (pendientes.data ?? []) as unknown as Shipment[],
    posiciones: (posiciones.data ?? []) as unknown as { driver_id: string; taken_at: string }[],
    movimientos: (movimientos.data ?? []) as unknown as {
      shipment_id: number;
      driver_id: string | null;
      event: string;
      happened_at: string;
    }[],
  };
}

export function ProveedorDelDia({ children }: { children: ReactNode }) {
  const [datos, setDatos] = useState(VACIO);
  const [tick, setTick] = useState(0);
  const [esAdmin, setEsAdmin] = useState(false);

  const refrescar = useCallback(() => setTick((n) => n + 1), []);

  /*
   * No se consulta nada hasta saber que del otro lado hay un admin.
   *
   * El marco del panel es de todas las pantallas de /admin, así que se dibuja
   * también en el instante en que un repartidor que escribió la dirección a
   * mano todavía no fue echado. Lo que traiga la base va a estar filtrado por
   * sus permisos igual —no vería nada ajeno— pero son cuatro consultas al
   * pedo y números de la oficina dibujados arriba de alguien que no es de la
   * oficina. El guardia de cada pantalla es el que echa; esto es para que
   * mientras tanto no se muestre ni se pida nada.
   */
  useEffect(() => {
    let vivo = true;
    leerSesion().then((s) => {
      if (vivo) setEsAdmin(s.rol === 'admin');
    });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;

    traer(hoyLocal())
      .then(({ deHoy, colgados, posiciones, movimientos }) => {
        if (!vivo) return;

        // Desde cuándo está en camino cada envío. Los movimientos vienen del
        // más viejo al más nuevo, así que la última salida pisa a la anterior:
        // si volvió a salir después de un intento fallido, cuenta esa.
        const enCaminoDesde = new Map<number, number>();
        const ultimaSenal = new Map<string, number>();

        for (const m of movimientos) {
          const cuando = Date.parse(m.happened_at);
          if (m.event === 'en_camino') enCaminoDesde.set(m.shipment_id, cuando);
          if (m.driver_id) {
            const previa = ultimaSenal.get(m.driver_id) ?? 0;
            if (cuando > previa) ultimaSenal.set(m.driver_id, cuando);
          }
        }

        for (const p of posiciones) {
          const cuando = Date.parse(p.taken_at);
          const previa = ultimaSenal.get(p.driver_id) ?? 0;
          if (cuando > previa) ultimaSenal.set(p.driver_id, cuando);
        }

        // Una tarjeta por repartidor CON ENVÍOS HOY, no por repartidor activo:
        // el que hoy no sale no tiene nada que mirarle.
        const porRepartidor = new Map<string, Repartidor>();
        const ahora = Date.now();

        for (const s of deHoy) {
          if (!s.assigned_driver) continue;
          const id = s.assigned_driver;
          const senal = ultimaSenal.get(id);

          const r =
            porRepartidor.get(id) ??
            ({
              id,
              nombre: s.driver?.full_name ?? 'Repartidor',
              haceMinutos: senal ? Math.max(0, Math.round((ahora - senal) / 60_000)) : null,
              entregados: 0,
              total: 0,
              lleva: 0,
            } satisfies Repartidor);

          r.total += 1;
          if (s.status === 'entregado') {
            r.entregados += 1;
            r.lleva += shipmentCash(s).atDelivery;
          }
          porRepartidor.set(id, r);
        }

        const repartidores = [...porRepartidor.values()].sort((a, b) =>
          a.nombre.localeCompare(b.nombre),
        );

        setDatos({
          cargando: false,
          deHoy,
          colgados,
          atrasos: buscarAtrasos({ envios: [...deHoy, ...colgados], enCaminoDesde }),
          repartidores,
          enCalle: repartidores.filter(
            (r) => r.haceMinutos !== null && r.haceMinutos <= MINUTOS_EN_CALLE,
          ).length,
          // Lo que falta cobrar, no lo que se cobró: el número es para saber
          // cuánta plata va a volver, no para contar la del día.
          aCobrar: deHoy
            .filter((s) => s.status !== 'entregado' && s.status !== 'cancelado')
            .reduce((n, s) => n + shipmentCash(s).atDelivery, 0),
          entregados: deHoy.filter((s) => s.status === 'entregado').length,
        });
      })
      .catch(() => {
        // Sin datos el tablero se queda como estaba. Un panel en blanco por un
        // corte de red asusta más de lo que informa, y vuelve en un minuto.
        if (vivo) setDatos((d) => ({ ...d, cargando: false }));
      });

    return () => {
      vivo = false;
    };
  }, [tick, esAdmin]);

  // Se mira todo el día de reojo: si no se refresca solo, no sirve.
  useEffect(() => {
    if (!esAdmin) return;
    const t = setInterval(refrescar, 60_000);
    return () => clearInterval(t);
  }, [refrescar, esAdmin]);

  const valor = useMemo(() => ({ ...datos, refrescar }), [datos, refrescar]);

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useDatosDelDia(): DatosDelDia {
  const v = useContext(Contexto);
  if (!v) throw new Error('useDatosDelDia va dentro de <ProveedorDelDia>');
  return v;
}
