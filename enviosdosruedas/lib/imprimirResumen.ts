import type { FilaResumen } from '@/lib/excelResumen';

/**
 * El mismo resumen, como PDF.
 *
 * NO SE ARMA UN PDF A MANO: se abre una ventana con el resumen ya diagramado
 * —logo, membrete, la tabla con bordes como la planilla de siempre— y se
 * dispara imprimir. "Guardar como PDF" del navegador hace el resto, con el
 * logo de verdad adentro. Es el mismo camino que usan las etiquetas, y evita
 * meter un generador de PDF entero por un archivo.
 *
 * La ventana es del mismo origen, así que `/logo-completo.webp` carga sin
 * permisos raros. Se espera a que la imagen esté lista antes de imprimir:
 * sin eso, el PDF sale con el hueco del logo vacío.
 */

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fechaCorta = (iso: string) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}/${a}` : iso;
};

const plata = (n: number) => '$ ' + Math.round(n).toLocaleString('es-AR');

/** El HTML entero de la vista, aparte: así se puede mirar sin abrir ventanas. */
export function htmlDelResumen(opciones: {
  cliente: string;
  cuit?: string | null;
  desde: string;
  hasta: string;
  filas: FilaResumen[];
}): string {
  const { cliente, cuit, desde, hasta, filas } = opciones;
  const total = filas.reduce((a, f) => a + f.valor, 0);
  const hoy = new Date();
  const emision = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

  const cuerpo = filas
    .map(
      (f, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td class="num">${esc(fechaCorta(f.fecha))}</td>
          <td>${esc(f.direccion)}</td>
          <td class="plata">${plata(f.valor)}</td>
        </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Resumen de envíos · ${esc(cliente)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 28px 32px; font-size: 12px; }
  .membrete { display: flex; align-items: center; gap: 16px; border-bottom: 3px solid #0636a5; padding-bottom: 12px; }
  .membrete img { height: 64px; }
  .membrete .quien h1 { font-size: 20px; color: #0636a5; letter-spacing: .5px; }
  .membrete .quien p { font-size: 11px; color: #444; margin-top: 2px; }
  h2 { text-align: center; font-size: 15px; margin: 18px 0 10px; letter-spacing: .5px; }
  .datos { font-size: 11.5px; margin-bottom: 12px; text-align: center; color: #222; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #999; padding: 5px 8px; }
  th { background: #e8edf8; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  td.num { text-align: center; white-space: nowrap; width: 1%; }
  td.plata { text-align: right; white-space: nowrap; width: 1%; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: bold; background: #f4f6fb; }
  .pie { margin-top: 14px; font-size: 10px; color: #666; text-align: center; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <div class="membrete">
    <img src="/logo-completo.webp" alt="Envíos DosRuedas" />
    <div class="quien">
      <h1>ENVIOS DOSRUEDAS</h1>
      <p>Servicio de mensajería y envíos – Mar del Plata</p>
      <p>Tel / WhatsApp: 223-6602699 · www.enviosdosruedas.com · www.logisticadosruedas.com</p>
    </div>
  </div>

  <h2>DETALLE DE ENVÍOS PENDIENTES DE PAGO</h2>
  <p class="datos">
    Cliente: <strong>${esc(cliente)}</strong>${cuit ? ` (CUIT ${esc(cuit)})` : ''}
    &nbsp;|&nbsp; Período: ${fechaCorta(desde)} al ${fechaCorta(hasta)}
    &nbsp;|&nbsp; Cantidad de envíos: ${filas.length}
    &nbsp;|&nbsp; Fecha de emisión: ${emision}
  </p>

  <table>
    <thead>
      <tr><th>N°</th><th>Fecha</th><th>Dirección de entrega</th><th>Valor</th></tr>
    </thead>
    <tbody>
      ${cuerpo}
      <tr class="total"><td colspan="3">TOTAL</td><td class="plata">${plata(total)}</td></tr>
    </tbody>
  </table>

  <p class="pie">Envíos DosRuedas · Mensajería y logística de última milla · Mar del Plata</p>

  <script>
    // Recién cuando el logo terminó de cargar: si no, el PDF sale sin él.
    const img = document.querySelector('img');
    const listo = () => setTimeout(() => window.print(), 150);
    if (img.complete) listo();
    else { img.onload = listo; img.onerror = listo; }
  </script>
</body>
</html>`;

  return html;
}

export function abrirImpresionResumen(
  opciones: Parameters<typeof htmlDelResumen>[0],
): void {
  const ventana = window.open('', '_blank');
  if (!ventana) return;
  ventana.document.write(htmlDelResumen(opciones));
  ventana.document.close();
}
