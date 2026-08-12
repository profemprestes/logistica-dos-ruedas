'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import AdminNav from '@/components/AdminNav';
import { dayShift, today, weekRange } from '@/lib/settlement';
import {
  calcular,
  plata,
  textoCompacto,
  textoDetallado,
  esShippy,
  type Ajustes,
} from '@/lib/resumen';
import { parsearResumen, type PedidoPegado } from '@/lib/resumenParse';
import {
  borrarResumen,
  guardarResumen,
  listarResumenes,
  traerDelSistema,
  type Origen,
  type ResumenGuardado,
} from '@/lib/resumenDb';

/**
 * Resúmenes de repartidor.
 *
 * Reemplaza al generador que corría en un HTML suelto y guardaba todo en el
 * navegador de una sola PC. Las cuentas son las mismas —están portadas tal
 * cual en `lib/resumen.ts`— y lo que cambia es de dónde salen los renglones y
 * dónde queda el resultado.
 *
 * Dos formas de cargar, y se pueden usar juntas en el mismo resumen: mientras
 * no entre el 100% de los envíos a la app, un día real es una parte traída del
 * sistema y otra pegada de WhatsApp. Por eso los dos botones agregan a la
 * misma tabla en vez de reemplazarla.
 */

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-yellow)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

interface Driver {
  id: string;
  full_name: string;
}

const OTRO = 'otro';

export default function ResumenesPage() {
  const ready = useAdminGuard();

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [nombreLibre, setNombreLibre] = useState('');

  const [desde, setDesde] = useState(today);
  const [hasta, setHasta] = useState(today);

  const [pedidos, setPedidos] = useState<PedidoPegado[]>([]);
  const [pegado, setPegado] = useState('');
  const [origenes, setOrigenes] = useState<Set<Origen>>(new Set());

  const [pendiente, setPendiente] = useState('0');
  const [rendido, setRendido] = useState('0');
  const [excluirShippy, setExcluirShippy] = useState(false);

  const [trayendo, setTrayendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  const [historial, setHistorial] = useState<ResumenGuardado[]>([]);
  const [verTexto, setVerTexto] = useState<ResumenGuardado | null>(null);
  /** Se sube de a uno para volver a pedir el historial después de guardar. */
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    if (!ready) return;
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'repartidor')
      .order('full_name')
      .then(({ data }) => {
        const list = (data ?? []) as Driver[];
        setDrivers(list);
        if (list.length) setDriverId((actual) => actual || list[0].id);
      });
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    let vivo = true;
    listarResumenes(dayShift(hasta, -60), hasta).then(({ data }) => {
      if (vivo) setHistorial((data ?? []) as ResumenGuardado[]);
    });
    return () => {
      vivo = false;
    };
  }, [ready, hasta, recarga]);

  const nombreRepartidor =
    driverId === OTRO
      ? nombreLibre.trim()
      : (drivers.find((d) => d.id === driverId)?.full_name ?? '');

  const ajustes: Ajustes = useMemo(
    () => ({
      pendiente: Number(pendiente) || 0,
      rendido: Number(rendido) || 0,
      excluirEfectivoShippy: excluirShippy,
    }),
    [pendiente, rendido, excluirShippy],
  );

  const totales = useMemo(() => calcular(pedidos, ajustes), [pedidos, ajustes]);

  const txtDetallado = useMemo(
    () => (pedidos.length ? textoDetallado(nombreRepartidor || 'Repartidor', pedidos, ajustes, totales) : ''),
    [pedidos, ajustes, totales, nombreRepartidor],
  );
  const txtCompacto = useMemo(
    () => (pedidos.length ? textoCompacto(nombreRepartidor || 'Repartidor', pedidos, totales) : ''),
    [pedidos, totales, nombreRepartidor],
  );

  const avisar = (msg: string) => {
    setAviso(msg);
    setError('');
    setTimeout(() => setAviso(''), 4000);
  };

  function marcarOrigen(o: Origen) {
    setOrigenes((prev) => new Set(prev).add(o));
  }

  const atajo = (d: string, h: string) => {
    setDesde(d);
    setHasta(h);
  };

  async function traer() {
    if (!driverId || driverId === OTRO) {
      return setError('Elegí un repartidor del sistema para traer sus envíos.');
    }
    setTrayendo(true);
    setError('');
    try {
      const nuevos = await traerDelSistema(driverId, desde, hasta);

      // Traer dos veces no duplica: los que ya están se reconocen por el envío.
      const yaEstan = new Set(pedidos.map((p) => p.shipmentId).filter(Boolean));
      const aAgregar = nuevos.filter((p) => !yaEstan.has(p.shipmentId));

      if (aAgregar.length === 0) {
        avisar(
          nuevos.length
            ? 'Esos envíos ya están en la tabla.'
            : 'No hay entregas cerradas de ese repartidor en el período.',
        );
      } else {
        setPedidos((p) => [...p, ...aAgregar]);
        marcarOrigen('sistema');
        avisar(`${aAgregar.length} envío(s) traídos del sistema.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron traer los envíos.');
    }
    setTrayendo(false);
  }

  function procesarPegado() {
    if (!pegado.trim()) return setError('Pegá el texto de WhatsApp primero.');
    const nuevos = parsearResumen(pegado);
    if (nuevos.length === 0) {
      return setError('No se reconoció ningún pedido. Tienen que decir ENVIO o COBRAR.');
    }
    setPedidos((p) => [...p, ...nuevos]);
    setPegado('');
    marcarOrigen('pegado');
    avisar(`${nuevos.length} pedido(s) agregados.`);
    setError('');
  }

  function actualizar(tempId: string, campo: keyof PedidoPegado, valor: string) {
    setPedidos((lista) =>
      lista.map((p) => {
        if (p.tempId !== tempId) return p;
        if (campo === 'cobrar' || campo === 'envio') {
          return { ...p, [campo]: Number(valor) || 0 };
        }
        if (campo === 'comercioOriginal') {
          const comercio = valor.toUpperCase();
          const shippy = esShippy(comercio);
          return {
            ...p,
            comercioOriginal: comercio,
            comercio: shippy ? 'SHIPPY' : comercio,
            esShippy: shippy,
          };
        }
        return { ...p, [campo]: valor };
      }),
    );
  }

  function agregarRenglon() {
    setPedidos((p) => [
      ...p,
      {
        tempId: crypto.randomUUID(),
        comercio: 'GENERAL',
        comercioOriginal: 'GENERAL',
        descripcion: '',
        cobrar: 0,
        envio: 0,
        esShippy: false,
        shipmentId: null,
        productos: [],
      },
    ]);
    marcarOrigen('pegado');
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      avisar('Copiado. Pegalo en WhatsApp.');
    } catch {
      setError('El navegador no dejó copiar. Seleccioná el texto a mano.');
    }
  }

  async function guardar() {
    if (!pedidos.length) return setError('No hay renglones para guardar.');
    if (!nombreRepartidor) return setError('Falta el nombre del repartidor.');

    setGuardando(true);
    setError('');
    try {
      await guardarResumen({
        driverId: driverId === OTRO ? null : driverId,
        driverName: nombreRepartidor,
        desde,
        hasta,
        origen:
          origenes.size > 1 ? 'mixto' : ((origenes.values().next().value ?? 'pegado') as Origen),
        ajustes,
        totales,
        pedidos,
        texto: txtDetallado,
        textoCompacto: txtCompacto,
      });
      avisar('Resumen guardado.');
      limpiar();
      setRecarga((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    }
    setGuardando(false);
  }

  function limpiar() {
    setPedidos([]);
    setPegado('');
    setOrigenes(new Set());
    setPendiente('0');
    setRendido('0');
    setExcluirShippy(false);
  }

  async function borrar(id: number) {
    if (!window.confirm('¿Borrar este resumen del historial?')) return;
    try {
      await borrarResumen(id);
      setHistorial((h) => h.filter((r) => r.id !== id));
      avisar('Resumen borrado.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar.');
    }
  }

  if (!ready) return null;

  const hoy = today();

  return (
    <div className="min-h-screen bg-[var(--edr-paper)]">
      <AdminNav />

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <h2 className="mb-1 text-xl font-black sm:text-2xl">Resumen del repartidor</h2>
        <p className="mb-4 text-sm text-[var(--edr-muted)]">
          Traé los envíos del sistema, pegá lo que falte de WhatsApp, y sale el resumen para
          mandar.
        </p>

        {/* ------------------------------------------------ quién y qué período */}
        <section className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className={labelCls}>Repartidor</label>
              <select
                className={campo}
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              >
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
                <option value={OTRO}>Otro (escribir)…</option>
              </select>
            </div>

            {driverId === OTRO && (
              <div>
                <label className={labelCls}>Nombre</label>
                <input
                  className={campo}
                  value={nombreLibre}
                  onChange={(e) => setNombreLibre(e.target.value)}
                  placeholder="Emi"
                />
              </div>
            )}

            <div>
              <label className={labelCls}>Desde</label>
              <input
                type="date"
                className={campo}
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Hasta</label>
              <input
                type="date"
                className={campo}
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </div>

            {/* Un día suelto es poner la misma fecha en los dos lados: el
                resumen semanal no necesita otra pantalla. */}
            <div className="flex flex-wrap gap-1">
              <Atajo label="Hoy" onClick={() => atajo(hoy, hoy)} />
              <Atajo
                label="Ayer"
                onClick={() => atajo(dayShift(hoy, -1), dayShift(hoy, -1))}
              />
              <Atajo
                label="Esta semana"
                onClick={() => {
                  const s = weekRange(hoy);
                  atajo(s.desde, s.hasta);
                }}
              />
              <Atajo
                label="Semana pasada"
                onClick={() => {
                  const s = weekRange(dayShift(hoy, -7));
                  atajo(s.desde, s.hasta);
                }}
              />
            </div>
          </div>
        </section>

        {aviso && (
          <div className="mb-3 rounded border border-emerald-400 bg-emerald-950 px-3 py-2 text-sm text-emerald-100">
            {aviso}
          </div>
        )}
        {error && (
          <div className="mb-3 rounded border border-red-400 bg-red-950 px-3 py-2 text-sm text-red-100">
            {error}
          </div>
        )}

        {/* --------------------------------------------- las dos formas de cargar */}
        <section className="mb-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-bold">1 · Traer del sistema</h3>
            <p className="mb-3 text-xs text-[var(--edr-muted)]">
              Las entregas que el repartidor cerró en la app durante el período, con el valor
              del envío y lo que cobró.
            </p>
            <button
              onClick={traer}
              disabled={trayendo}
              className="rounded bg-[var(--edr-blue)] px-4 py-2 text-sm font-bold text-white hover:brightness-110 disabled:opacity-50"
            >
              {trayendo ? 'Trayendo…' : '⬇ Traer envíos del sistema'}
            </button>
          </div>

          <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
            <h3 className="mb-1 text-sm font-bold">2 · Pegar de WhatsApp</h3>
            <p className="mb-2 text-xs text-[var(--edr-muted)]">
              Para lo que no pasó por la app. Se suma a lo de arriba.
            </p>
            <textarea
              value={pegado}
              onChange={(e) => setPegado(e.target.value)}
              rows={4}
              placeholder={'*TOYPIOLA*\n- CALABRIA 5543. ENVIO $5300 (NO COBRAR)'}
              className={`${campo} w-full font-mono text-xs`}
            />
            <button
              onClick={procesarPegado}
              className="mt-2 rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-black hover:brightness-95"
            >
              Procesar texto
            </button>
          </div>
        </section>

        {/* ------------------------------------------------------------- la tabla */}
        {pedidos.length > 0 && (
          <section className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold">{pedidos.length} renglones</h3>
              <button
                onClick={agregarRenglon}
                className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-bold hover:bg-[var(--edr-surface-2)]"
              >
                + Agregar renglón
              </button>
              <button
                onClick={limpiar}
                className="ml-auto rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold text-[var(--edr-muted)] hover:bg-[var(--edr-surface-2)]"
              >
                Limpiar todo
              </button>
            </div>

            <div className="-mx-3 overflow-x-auto px-3">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">
                    <th className="pb-1 pr-2">Comercio</th>
                    <th className="pb-1 pr-2">Dirección / referencia</th>
                    <th className="pb-1 pr-2 text-right">Cobrar</th>
                    <th className="pb-1 pr-2 text-right">Envío</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {pedidos.map((p) => (
                    <tr key={p.tempId} className={p.esShippy ? 'bg-purple-950/30' : ''}>
                      <td className="py-1 pr-2">
                        <input
                          className={`${campo} w-32 px-2 py-1 text-xs`}
                          value={p.comercioOriginal}
                          onChange={(e) => actualizar(p.tempId, 'comercioOriginal', e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          className={`${campo} w-full px-2 py-1 text-xs`}
                          value={p.descripcion}
                          onChange={(e) => actualizar(p.tempId, 'descripcion', e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          type="number"
                          className={`${campo} w-24 px-2 py-1 text-right text-xs`}
                          value={p.cobrar}
                          onChange={(e) => actualizar(p.tempId, 'cobrar', e.target.value)}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        {/* Un envío en cero casi siempre es un dato que faltó
                            escribir, no un envío gratis: se marca en rojo. */}
                        <input
                          type="number"
                          className={`${campo} w-24 px-2 py-1 text-right text-xs ${
                            !p.esShippy && p.envio === 0 ? 'border-red-500' : ''
                          }`}
                          value={p.envio}
                          onChange={(e) => actualizar(p.tempId, 'envio', e.target.value)}
                        />
                      </td>
                      <td className="py-1">
                        <button
                          onClick={() =>
                            setPedidos((lista) => lista.filter((x) => x.tempId !== p.tempId))
                          }
                          className="rounded bg-red-900 px-2 py-1 text-xs font-bold text-red-100 hover:bg-red-800"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ------------------------------------------------- ajustes y resultado */}
        {pedidos.length > 0 && (
          <>
            <section className="mb-4 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelCls}>Pendiente de antes</label>
                  <input
                    type="number"
                    className={`${campo} w-32`}
                    value={pendiente}
                    onChange={(e) => setPendiente(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>Rendido a cuenta</label>
                  <input
                    type="number"
                    className={`${campo} w-32`}
                    value={rendido}
                    onChange={(e) => setRendido(e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={excluirShippy}
                    onChange={(e) => setExcluirShippy(e.target.checked)}
                  />
                  Dejar el efectivo de Shippy afuera de la caja
                </label>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <Dato label="Envíos locales" valor={plata(totales.enviosNormales)} />
                <Dato
                  label={`Envíos Shippy (${totales.cantidadShippy})`}
                  valor={plata(totales.enviosShippy)}
                />
                <Dato label="Efectivo en calle" valor={plata(totales.efectivoTotal)} />
                <Dato label="A pagar al cadete" valor={plata(totales.aPagarTotal)} />
                <Dato
                  label={totales.aRendir < 0 ? 'A pagarle a él' : 'A rendir'}
                  valor={plata(Math.abs(totales.aRendir))}
                  destacado
                />
              </div>

              <p className="mt-2 text-xs text-[var(--edr-muted)]">
                Ganancia de la mensajería en este resumen:{' '}
                <span className="font-bold text-[var(--edr-yellow)]">
                  {plata(totales.ganancia)}
                </span>
              </p>
            </section>

            <section className="mb-6 grid gap-3 lg:grid-cols-2">
              <Salida titulo="Resumen detallado" texto={txtDetallado} onCopiar={copiar} />
              <Salida titulo="Resumen compacto" texto={txtCompacto} onCopiar={copiar} />
            </section>

            <div className="mb-8">
              <button
                onClick={guardar}
                disabled={guardando}
                className="rounded bg-emerald-600 px-5 py-3 text-sm font-black text-white hover:brightness-110 disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : '💾 Guardar resumen'}
              </button>
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- historial */}
        <section className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3 sm:p-4">
          <h3 className="mb-2 text-sm font-bold">Resúmenes guardados</h3>

          {historial.length === 0 ? (
            <p className="py-4 text-center text-sm text-[var(--edr-muted)]">
              Todavía no hay resúmenes guardados en los últimos 60 días.
            </p>
          ) : (
            <div className="-mx-3 overflow-x-auto px-3">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">
                    <th className="pb-1 pr-3">Período</th>
                    <th className="pb-1 pr-3">Repartidor</th>
                    <th className="pb-1 pr-3">Origen</th>
                    <th className="pb-1 pr-3 text-right">A pagar</th>
                    <th className="pb-1 pr-3 text-right">A rendir</th>
                    <th className="pb-1 pr-3 text-right">Ganancia</th>
                    <th className="pb-1" />
                  </tr>
                </thead>
                <tbody>
                  {historial.map((r) => (
                    <tr key={r.id} className="border-t border-[var(--edr-border)]">
                      <td className="py-2 pr-3">
                        {r.desde === r.hasta ? fecha(r.desde) : `${fecha(r.desde)} al ${fecha(r.hasta)}`}
                      </td>
                      <td className="py-2 pr-3 font-semibold">{r.driver_name}</td>
                      <td className="py-2 pr-3 text-xs text-[var(--edr-muted)]">{r.origen}</td>
                      <td className="py-2 pr-3 text-right">{plata(Number(r.pago_repartidor))}</td>
                      <td className="py-2 pr-3 text-right font-bold">
                        {Number(r.a_rendir) < 0
                          ? `-${plata(Math.abs(Number(r.a_rendir)))}`
                          : plata(Number(r.a_rendir))}
                      </td>
                      <td className="py-2 pr-3 text-right text-[var(--edr-yellow)]">
                        {plata(Number(r.ganancia))}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => setVerTexto(r)}
                          className="mr-1 rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
                        >
                          Ver
                        </button>
                        <button
                          onClick={() => borrar(r.id)}
                          className="rounded border border-[var(--edr-border)] px-2 py-1 text-xs font-semibold text-red-300 hover:bg-red-950"
                        >
                          Borrar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {verTexto && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3"
          onClick={() => setVerTexto(null)}
        >
          <div
            className="my-6 w-full max-w-2xl rounded-lg bg-[var(--edr-surface)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold">
                {verTexto.driver_name} · {fecha(verTexto.desde)}
                {verTexto.desde !== verTexto.hasta ? ` al ${fecha(verTexto.hasta)}` : ''}
              </h3>
              <button
                onClick={() => setVerTexto(null)}
                className="rounded px-2 text-2xl leading-none text-[var(--edr-muted)]"
              >
                ×
              </button>
            </div>
            <Salida
              titulo="Como se mandó"
              texto={verTexto.texto ?? ''}
              onCopiar={copiar}
            />
          </div>
        </div>
      )}
    </div>
  );
}

const fecha = (iso: string) => iso.split('-').reverse().join('/');

function Atajo({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded border border-[var(--edr-border)] px-2 py-2 text-xs font-semibold hover:bg-[var(--edr-surface-2)]"
    >
      {label}
    </button>
  );
}

function Dato({
  label,
  valor,
  destacado = false,
}: {
  label: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div
      className={`rounded border px-3 py-2 ${
        destacado
          ? 'border-[var(--edr-yellow)] bg-[var(--edr-surface-2)]'
          : 'border-[var(--edr-border)]'
      }`}
    >
      <div className="text-[10px] uppercase tracking-wide text-[var(--edr-muted)]">{label}</div>
      <div className="edr-mono text-lg font-black">{valor}</div>
    </div>
  );
}

function Salida({
  titulo,
  texto,
  onCopiar,
}: {
  titulo: string;
  texto: string;
  onCopiar: (t: string) => void;
}) {
  return (
    <div className="rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold">{titulo}</h3>
        <button
          onClick={() => onCopiar(texto)}
          className="rounded bg-[var(--edr-yellow)] px-3 py-1 text-xs font-black text-black hover:brightness-95"
        >
          Copiar
        </button>
      </div>
      <textarea
        readOnly
        value={texto}
        rows={14}
        className="w-full rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] px-2 py-2 font-mono text-xs outline-none"
      />
    </div>
  );
}
