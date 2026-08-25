'use client';

import { useEffect, useState } from 'react';
import { FileSpreadsheet, FileText, Search, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAdminGuard } from '@/lib/adminGuard';
import { money } from '@/lib/format';
import {
  armarFilasResumen,
  descargarExcelResumen,
  type EnvioParaResumen,
  type FilaResumen,
} from '@/lib/excelResumen';
import { abrirImpresionResumen } from '@/lib/imprimirResumen';

/**
 * Facturación: el resumen de envíos de un comercio, listo para cobrar.
 *
 * EL FLUJO ES MIRAR ANTES DE MANDAR. Se elige comercio y período, el sistema
 * arma la tabla —los entregados, con las paradas de un mismo envío unidas en
 * una línea— y la tabla SE PUEDE CORREGIR ACÁ: tocar un valor, retocar una
 * dirección, sacar una fila que no va. Recién después sale el archivo, como
 * Excel o como PDF con el membrete. Lo que se edita acá no toca los envíos:
 * es el documento que se manda, no el historial.
 *
 * Reemplaza a la planilla que se armaba a mano afuera del sistema (el
 * "RESUMEN ENVIOS ..." de siempre), con el mismo formato.
 */

const campo =
  'rounded border border-[var(--edr-border)] bg-[var(--edr-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--edr-acento)]';
const labelCls =
  'block text-[10px] font-semibold uppercase tracking-wide text-[var(--edr-muted)] mb-0.5';

interface ComercioDeLista {
  id: number;
  name: string;
  cuit: string | null;
  parent_id: number | null;
}

function hoyLocalISO(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Sin tildes y en minúscula, para que "condor" encuentre "EL CÓNDOR". */
const parecido = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export default function FacturacionPage() {
  const ready = useAdminGuard();

  const [comercios, setComercios] = useState<ComercioDeLista[]>([]);
  /* Arranca con el comercio del link (?comercio=ID), que es como se llega
     desde la ficha. Sin link, se elige a mano. */
  const [comercioId, setComercioId] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return Number(new URLSearchParams(window.location.search).get('comercio')) || 0;
  });
  /** Lo escrito en el buscador de comercios. */
  const [busqueda, setBusqueda] = useState('');
  const [desde, setDesde] = useState(() => `${hoyLocalISO().slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(() => hoyLocalISO());

  const [filas, setFilas] = useState<FilaResumen[]>([]);
  /** De qué pedido son las filas en pantalla, para el encabezado del archivo. */
  const [generadoPara, setGeneradoPara] = useState<{
    comercio: ComercioDeLista;
    desde: string;
    hasta: string;
  } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (!ready) return;
    let vivo = true;

    const traer = async () => {
      // El CUIT llega con el paso 58: si la columna todavía no está, se pide
      // sin ella y la pantalla sigue andando.
      const con = await supabase
        .from('clients')
        .select('id, name, cuit, parent_id')
        .eq('active', true)
        .order('name');
      const r = con.error && /cuit/.test(con.error.message)
        ? await supabase.from('clients').select('id, name, parent_id').eq('active', true).order('name')
        : con;

      if (!vivo) return;
      if (r.error) return setAviso(r.error.message);

      type Fila = { id: number; name: string; cuit?: string | null; parent_id: number | null };
      const lista = ((r.data ?? []) as Fila[]).map((c) => ({
        id: c.id,
        name: c.name,
        cuit: c.cuit ?? null,
        parent_id: c.parent_id,
      }));
      setComercios(lista);
    };

    void traer();
    return () => {
      vivo = false;
    };
  }, [ready]);

  /*
   * Se factura al NEGOCIO, no al local: el selector lista las casas centrales
   * y los comercios sueltos. Las sucursales entran solas en el resumen de su
   * central.
   */
  const facturables = comercios.filter((c) => c.parent_id == null);
  const comercioElegido = facturables.find((c) => c.id === comercioId) ?? null;
  const sugeridos = facturables
    .filter((c) => parecido(c.name).includes(parecido(busqueda.trim())))
    .slice(0, 8);

  async function generar() {
    const comercio = comercios.find((c) => c.id === comercioId);
    if (!comercio) return setAviso('Elegí el comercio.');

    setBuscando(true);
    setAviso('');

    const ids = [comercio.id, ...comercios.filter((c) => c.parent_id === comercio.id).map((c) => c.id)];
    const { data, error } = await supabase
      .from('shipments')
      .select(
        'id, parte_de, delivered_at, scheduled_date, address_street, address_extra, shipping_fee, client_name_raw',
      )
      .in('client_id', ids)
      .eq('status', 'entregado')
      .gte('delivered_at', `${desde}T00:00:00-03:00`)
      .lte('delivered_at', `${hasta}T23:59:59-03:00`)
      .order('delivered_at', { ascending: true });

    setBuscando(false);

    if (error) return setAviso(error.message);
    if (!data?.length) {
      setFilas([]);
      setGeneradoPara(null);
      return setAviso('No hay envíos entregados de ese comercio en ese período.');
    }

    setFilas(armarFilasResumen(data as EnvioParaResumen[], comercio.name));
    setGeneradoPara({ comercio, desde, hasta });
  }

  const setFila = (i: number, patch: Partial<FilaResumen>) =>
    setFilas((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const total = filas.reduce((a, f) => a + f.valor, 0);

  const opcionesArchivo = () =>
    generadoPara && {
      cliente: generadoPara.comercio.name,
      cuit: generadoPara.comercio.cuit,
      desde: generadoPara.desde,
      hasta: generadoPara.hasta,
      filas,
    };

  if (!ready) return <div className="p-8 text-sm text-[var(--edr-muted)]">Cargando…</div>;

  return (
    <main className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-6">
      <h2 className="mb-1 text-xl font-black sm:text-2xl">Facturación</h2>
      <p className="mb-4 text-sm text-[var(--edr-muted)]">
        El detalle de envíos entregados de un comercio, para cobrarle el período. Se puede corregir
        acá antes de bajarlo — lo que edites no toca los envíos, sólo el documento.
      </p>

      {/* ------------------------------------------------ elegir qué */}
      <section className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--edr-border)] bg-[var(--edr-surface)] p-3">
        <div className="relative min-w-48 flex-1">
          <label className={labelCls}>Comercio</label>
          {/* Un buscador y no un desplegable: con veinte comercios ya se hace
              largo scrollear, y esto va a seguir creciendo. Se escribe un
              pedazo del nombre —sin importar tildes ni mayúsculas— y se elige
              de la lista. El elegido queda como chip, con la cruz para
              cambiarlo. */}
          {comercioElegido ? (
            <div className="flex items-center gap-2 rounded border border-[var(--edr-acento)] bg-[var(--edr-surface-2)] px-3 py-2 text-sm font-bold">
              <span className="min-w-0 flex-1 truncate">{comercioElegido.name}</span>
              <button
                onClick={() => {
                  setComercioId(0);
                  setBusqueda('');
                }}
                aria-label="Cambiar de comercio"
                className="shrink-0 text-[var(--edr-muted)] hover:text-[var(--edr-rojo-claro)]"
              >
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--edr-muted)]"
                />
                <input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Escribí el nombre del comercio…"
                  autoFocus
                  className={`${campo} w-full pl-8`}
                />
              </div>
              {busqueda.trim() && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded border border-[var(--edr-border)] bg-[var(--edr-surface-2)] shadow-lg">
                  {sugeridos.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-[var(--edr-muted)]">
                      Ningún comercio con ese nombre.
                    </p>
                  ) : (
                    sugeridos.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setComercioId(c.id);
                          setBusqueda('');
                        }}
                        className="block w-full px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--edr-surface)]"
                      >
                        {c.name}
                        {c.cuit ? (
                          <span className="ml-2 text-xs font-normal text-[var(--edr-muted)]">
                            CUIT {c.cuit}
                          </span>
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div>
          <label className={labelCls}>Desde</label>
          <input type="date" className={campo} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Hasta</label>
          <input type="date" className={campo} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <button
          onClick={generar}
          disabled={buscando || !comercioId}
          className="rounded bg-[var(--edr-yellow)] px-4 py-2 text-sm font-black text-[var(--edr-blue)] hover:brightness-95 disabled:opacity-50"
        >
          {buscando ? 'Buscando…' : 'Armar resumen'}
        </button>
      </section>

      {aviso && (
        <p className="mb-4 rounded border border-orange-300 bg-orange-50 px-3 py-2 text-sm text-orange-900">
          {aviso}
        </p>
      )}

      {/* ------------------------------------------------ la tabla editable */}
      {generadoPara && filas.length > 0 && (
        <>
          <section className="overflow-x-auto rounded border border-[var(--edr-border)] bg-[var(--edr-surface)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--edr-surface-2)] text-left text-xs uppercase text-[var(--edr-muted)]">
                <tr>
                  <th className="px-3 py-2">N°</th>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Dirección de entrega</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={i} className="border-t border-[var(--edr-border)]">
                    <td className="edr-mono px-3 py-1.5 text-xs text-[var(--edr-muted)]">{i + 1}</td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={f.fecha}
                        onChange={(e) => setFila(i, { fecha: e.target.value })}
                        className="rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-[var(--edr-border)] focus:border-[var(--edr-acento)]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={f.direccion}
                        onChange={(e) => setFila(i, { direccion: e.target.value })}
                        className="w-full min-w-56 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm outline-none hover:border-[var(--edr-border)] focus:border-[var(--edr-acento)]"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input
                        type="number"
                        value={f.valor || ''}
                        onChange={(e) => setFila(i, { valor: Number(e.target.value) || 0 })}
                        className="edr-mono w-28 rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-sm font-bold outline-none hover:border-[var(--edr-border)] focus:border-[var(--edr-acento)]"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <button
                        onClick={() => setFilas((fs) => fs.filter((_, j) => j !== i))}
                        title="Sacar esta fila del resumen"
                        className="rounded p-1 text-[var(--edr-muted)] hover:text-[var(--edr-rojo-claro)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--edr-yellow)] font-black">
                  <td className="px-3 py-2" colSpan={3}>
                    TOTAL · {filas.length} envío{filas.length === 1 ? '' : 's'}
                  </td>
                  <td className="edr-mono px-3 py-2 text-right">{money(total)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </section>

          {/* -------------------------------------------- bajarlo */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                const o = opcionesArchivo();
                if (o) descargarExcelResumen(o);
              }}
              className="inline-flex items-center gap-2 rounded bg-[var(--edr-yellow)] px-4 py-2.5 text-sm font-black text-[var(--edr-blue)] hover:brightness-95"
            >
              <FileSpreadsheet size={16} /> Descargar Excel
            </button>
            <button
              onClick={() => {
                const o = opcionesArchivo();
                if (o) abrirImpresionResumen(o);
              }}
              className="inline-flex items-center gap-2 rounded border border-[var(--edr-yellow)] px-4 py-2.5 text-sm font-black text-[var(--edr-acento)] hover:bg-[var(--edr-surface-2)]"
            >
              <FileText size={16} /> PDF con membrete
            </button>
            <span className="text-xs text-[var(--edr-muted)]">
              El PDF abre la vista de impresión: elegí «Guardar como PDF».
            </span>
          </div>
        </>
      )}
    </main>
  );
}
