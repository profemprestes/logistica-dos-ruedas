import { tratoDirectoDe } from '@/lib/resumen';

/**
 * El resumen de envíos de un comercio, como archivo de Excel.
 *
 * Reproduce el formato con el que ya se factura a mano (el PDF "RESUMEN
 * ENVIOS ... RESUMEN PENDIENTES" que se armaba en una planilla aparte):
 * membrete de la empresa, "DETALLE DE ENVÍOS PENDIENTES DE PAGO", la línea de
 * cliente/período/cantidad/emisión, y la tabla N° · FECHA · DIRECCIÓN DE
 * ENTREGA · VALOR con el total al pie.
 *
 * ES UN .xlsx DE VERDAD, no un CSV disfrazado: los valores van como números
 * con formato de moneda, así en Excel se pueden sumar y tocar sin pelearse
 * con los signos $. Se arma a mano —un zip sin comprimir con los XML
 * mínimos— para no colgar una dependencia entera por un solo archivo.
 */

/**
 * Los datos para pagar por transferencia. Van al pie del resumen —en el PDF y
 * en el Excel— para que el comercio no tenga que pedirlos por WhatsApp.
 */
export const DATOS_PAGO = {
  alias: 'enviosdosruedas',
  titular: 'Matias Nicolas Cejas',
  cuit: '20-34987367-3',
  banco: 'BruBank',
} as const;

/** Una fila del detalle. */
export interface FilaResumen {
  /** yyyy-mm-dd (se muestra dd/mm/aaaa). */
  fecha: string;
  direccion: string;
  valor: number;
}

/** Lo que la consulta trae de cada envío entregado, crudo. */
export interface EnvioParaResumen {
  id: number;
  parte_de: number | null;
  delivered_at: string | null;
  scheduled_date: string;
  address_street: string | null;
  address_extra: string | null;
  shipping_fee: number | null;
  client_name_raw: string | null;
}

/**
 * De los envíos crudos a las filas del resumen.
 *
 * UN ENVÍO CON VARIAS PARADAS ES UNA SOLA LÍNEA (paso 53): "Guido 1178 /
 * Libertad 5140" con un solo valor — el comercio pagó UN envío aunque la moto
 * haya parado dos veces. El valor del grupo es la suma de lo cargado en sus
 * paradas (la plata puede estar en cualquiera), y para los comercios con
 * tarifa fija de facturación (Conectta) va la tarifa UNA vez por grupo, no
 * por parada.
 *
 * Una parada cuyo envío principal quedó fuera del período sale como línea
 * suelta con lo que tenga cargado, sin inventarle tarifa: ese pedido se
 * factura con su principal, y la línea queda a la vista para decidir a mano.
 */
export function armarFilasResumen(
  envios: EnvioParaResumen[],
  nombreComercio: string,
): FilaResumen[] {
  const dir = (e: EnvioParaResumen) =>
    [e.address_street, e.address_extra].filter(Boolean).join(' ').trim() || '(sin dirección)';
  const fechaDe = (e: EnvioParaResumen) =>
    String(e.delivered_at ?? e.scheduled_date).slice(0, 10);

  const ids = new Set(envios.map((e) => e.id));
  const principales = envios.filter((e) => e.parte_de == null);
  const partesDe = new Map<number, EnvioParaResumen[]>();
  const sueltas: EnvioParaResumen[] = [];

  for (const e of envios) {
    if (e.parte_de == null) continue;
    if (ids.has(e.parte_de)) {
      const lista = partesDe.get(e.parte_de) ?? [];
      lista.push(e);
      partesDe.set(e.parte_de, lista);
    } else {
      sueltas.push(e);
    }
  }

  const filas: FilaResumen[] = principales.map((p) => {
    const grupo = [p, ...(partesDe.get(p.id) ?? [])];
    const cargado = grupo.reduce((a, e) => a + (Number(e.shipping_fee) || 0), 0);
    return {
      fecha: fechaDe(p),
      direccion: grupo.map(dir).join(' / '),
      valor: valorFacturado(p.client_name_raw ?? nombreComercio, cargado),
    };
  });

  for (const e of sueltas) {
    filas.push({
      fecha: fechaDe(e),
      direccion: `${dir(e)} (parada de un envío repartido)`,
      valor: Number(e.shipping_fee) || 0,
    });
  }

  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Lo que se le factura al comercio por un envío.
 *
 * Para los de trato directo con tarifa de facturación fija —Conectta: $3.000
 * por envío entregado, la aclare o no— manda la regla. Para el resto, lo que
 * el envío tiene cargado.
 */
export function valorFacturado(comercio: string, shippingFee: number): number {
  const trato = tratoDirectoDe(comercio);
  if (trato?.facturaPorEnvio) return trato.facturaPorEnvio;
  return Number(shippingFee) || 0;
}

/* ------------------------------------------------------------------ zip */

const CRC_TABLA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = CRC_TABLA[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Un zip SIN comprimir (método "store"). Excel no exige compresión, y así el
 * armado son cabeceras y nada más — sin traer una librería de deflate.
 */
function zipStore(archivos: { nombre: string; datos: Uint8Array }[]): Uint8Array {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
  const u32 = (n: number) =>
    new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff]);
  const junta = (xs: Uint8Array[]) => {
    const total = xs.reduce((a, x) => a + x.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const x of xs) {
      out.set(x, p);
      p += x.length;
    }
    return out;
  };

  for (const { nombre, datos } of archivos) {
    const nom = new TextEncoder().encode(nombre);
    const crc = crc32(datos);

    const local = junta([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(datos.length), u32(datos.length), u16(nom.length), u16(0),
      nom, datos,
    ]);
    partes.push(local);

    central.push(
      junta([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(datos.length), u32(datos.length), u16(nom.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nom,
      ]),
    );
    offset += local.length;
  }

  const dirCentral = junta(central);
  const fin = junta([
    u32(0x06054b50), u16(0), u16(0), u16(archivos.length), u16(archivos.length),
    u32(dirCentral.length), u32(offset), u16(0),
  ]);

  return junta([...partes, dirCentral, fin]);
}

/* ----------------------------------------------------------------- xlsx */

const esc = (s: string) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** dd/mm/aaaa, que es como lo escribe el resumen de siempre. */
const fechaCorta = (iso: string) => {
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m ? `${d}/${m}/${a}` : iso;
};

/**
 * Celdas: `t` texto, `n` número plano, `m` moneda. `s` es el estilo:
 * 0 normal · 1 negrita · 2 título · 3 moneda · 4 moneda negrita · 5 gris chico
 */
type Celda =
  | { t: string; s?: number }
  | { n: number; s?: number }
  | { m: number; s?: number }
  | null;

function hoja(filas: Celda[][]): string {
  const col = (i: number) => {
    let n = i + 1;
    let letra = '';
    while (n > 0) {
      letra = String.fromCharCode(65 + ((n - 1) % 26)) + letra;
      n = Math.floor((n - 1) / 26);
    }
    return letra;
  };

  const cuerpo = filas
    .map((fila, rIdx) => {
      const celdas = fila
        .map((c, cIdx) => {
          if (c === null) return '';
          const ref = `${col(cIdx)}${rIdx + 1}`;
          if ('t' in c) {
            return `<c r="${ref}" s="${c.s ?? 0}" t="inlineStr"><is><t xml:space="preserve">${esc(c.t)}</t></is></c>`;
          }
          const s = 'm' in c ? (c.s ?? 3) : (c.s ?? 0);
          const v = 'm' in c ? c.m : c.n;
          return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
        })
        .join('');
      return `<row r="${rIdx + 1}">${celdas}</row>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<cols>' +
    '<col min="1" max="1" width="6" customWidth="1"/>' +
    '<col min="2" max="2" width="13" customWidth="1"/>' +
    '<col min="3" max="3" width="48" customWidth="1"/>' +
    '<col min="4" max="4" width="14" customWidth="1"/>' +
    '</cols>' +
    `<sheetData>${cuerpo}</sheetData>` +
    '</worksheet>'
  );
}

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot; #,##0"/></numFmts>' +
  '<fonts count="4">' +
  '<font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
  '<font><sz val="9"/><color rgb="FF666666"/><name val="Calibri"/></font>' +
  '</fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/>' +
  '</cellXfs>' +
  '</styleSheet>';

/** El archivo entero, como bytes. Separado de la descarga para poder probarlo sin navegador. */
export function armarExcelResumen(opciones: {
  cliente: string;
  cuit?: string | null;
  desde: string;
  hasta: string;
  filas: FilaResumen[];
}): Uint8Array {
  const { cliente, cuit, desde, hasta, filas } = opciones;
  const total = filas.reduce((a, f) => a + f.valor, 0);
  const hoy = new Date();
  const emision = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;

  const contenido: Celda[][] = [
    [{ t: 'ENVIOS DOSRUEDAS', s: 2 }],
    [{ t: 'Servicio de mensajería y envíos – Mar del Plata', s: 5 }],
    [{ t: 'Tel / WhatsApp: 223-6602699 · www.enviosdosruedas.com', s: 5 }],
    [],
    [{ t: 'DETALLE DE ENVÍOS PENDIENTES DE PAGO', s: 1 }],
    [
      {
        t:
          `Cliente: ${cliente}${cuit ? ` (CUIT ${cuit})` : ''} | ` +
          `Período: ${fechaCorta(desde)} al ${fechaCorta(hasta)} | ` +
          `Cantidad de envíos: ${filas.length} | Fecha de emisión: ${emision}`,
      },
    ],
    [],
    [{ t: 'N°', s: 1 }, { t: 'FECHA', s: 1 }, { t: 'DIRECCIÓN DE ENTREGA', s: 1 }, { t: 'VALOR', s: 1 }],
    ...filas.map((f, i): Celda[] => [
      { n: i + 1 },
      { t: fechaCorta(f.fecha) },
      { t: f.direccion },
      { m: f.valor },
    ]),
    [null, null, { t: 'TOTAL', s: 1 }, { m: total, s: 4 }],
    [],
    [{ t: 'En caso de realizar el pago por transferencia:', s: 1 }],
    [{ t: `Alias: ${DATOS_PAGO.alias}` }],
    [{ t: `Titular: ${DATOS_PAGO.titular}` }],
    [{ t: `CUIT: ${DATOS_PAGO.cuit}` }],
    [{ t: `Banco: ${DATOS_PAGO.banco}` }],
  ];

  const xml = (s: string) => new TextEncoder().encode(s);

  return zipStore([
    {
      nombre: '[Content_Types].xml',
      datos: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>',
      ),
    },
    {
      nombre: '_rels/.rels',
      datos: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    },
    {
      nombre: 'xl/workbook.xml',
      datos: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets><sheet name="Resumen" sheetId="1" r:id="rId1"/></sheets>' +
          '</workbook>',
      ),
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      datos: xml(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>',
      ),
    },
    { nombre: 'xl/styles.xml', datos: xml(ESTILOS) },
    { nombre: 'xl/worksheets/sheet1.xml', datos: xml(hoja(contenido)) },
  ]);
}

/** Arma y baja el archivo en el navegador. */
export function descargarExcelResumen(opciones: Parameters<typeof armarExcelResumen>[0]): void {
  const bytes = armarExcelResumen(opciones);
  // El TypedArray se copia a un ArrayBuffer pelado: Blob no acepta el buffer
  // compartido de un Uint8Array con offset.
  const blob = new Blob([new Uint8Array(bytes)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const limpio = opciones.cliente.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '_');
  a.download = `resumen-envios-${limpio}-${opciones.desde}-al-${opciones.hasta}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
