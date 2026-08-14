/**
 * Un ZIP, sin comprimir y sin librerías.
 *
 * POR QUÉ SIN COMPRIMIR. Adentro van fotos JPEG, que YA están comprimidas:
 * pasarlas por el compresor del ZIP no les saca casi nada y cuesta segundos de
 * celular por cada una. Guardándolas tal cual, armar el archivo es pegar
 * pedazos, y el resultado lo abre cualquier computadora igual — "sin comprimir"
 * es un modo del formato de toda la vida, no un truco.
 *
 * POR QUÉ SIN LIBRERÍA. La que se usa siempre pesa más que todo esto y traería
 * al proyecto una dependencia nueva para algo que, hecho así, son cincuenta
 * líneas. Lo delicado del formato es el CRC y los tamaños; de eso se encarga
 * la prueba, que arma un ZIP y lo vuelve a abrir con otra herramienta.
 *
 * Límite: hasta 4 GB. Una jornada de fotos son unos pocos MB.
 */

export interface ArchivoZip {
  nombre: string;
  /**
   * El tipo lleva `<ArrayBuffer>` a propósito. Un `Uint8Array` a secas puede
   * estar apoyado en memoria compartida, y de esa el navegador no arma un
   * archivo: TypeScript lo marca antes de que se vea en pantalla.
   */
  datos: Uint8Array<ArrayBuffer>;
}

/**
 * El CRC-32 que pide el formato para cada archivo.
 *
 * Es la comprobación que hace el descompresor para saber si el contenido
 * llegó entero. Si esto estuviera mal, el ZIP abriría y diría que está dañado.
 */
const TABLA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array<ArrayBuffer>): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** La fecha, en el formato de dos bytes que usa el ZIP desde los años 80. */
function fechaDos(d: Date): { hora: number; fecha: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    fecha: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export function armarZip(archivos: ArchivoZip[], cuando = new Date()): Blob {
  const { hora, fecha } = fechaDos(cuando);
  const codificador = new TextEncoder();

  const partes: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const archivo of archivos) {
    const nombre = codificador.encode(archivo.nombre);
    const crc = crc32(archivo.datos);
    const largo = archivo.datos.length;

    // Encabezado de cada archivo, justo antes de su contenido.
    const local = new Uint8Array(30 + nombre.length);
    const vLocal = new DataView(local.buffer);
    vLocal.setUint32(0, 0x04034b50, true); // firma
    vLocal.setUint16(4, 20, true); // versión necesaria
    vLocal.setUint16(6, 0x0800, true); // los nombres van en UTF-8
    vLocal.setUint16(8, 0, true); // método 0 = guardado tal cual
    vLocal.setUint16(10, hora, true);
    vLocal.setUint16(12, fecha, true);
    vLocal.setUint32(14, crc, true);
    vLocal.setUint32(18, largo, true); // comprimido
    vLocal.setUint32(22, largo, true); // original: el mismo, no se comprime
    vLocal.setUint16(26, nombre.length, true);
    vLocal.setUint16(28, 0, true); // sin extras
    local.set(nombre, 30);

    partes.push(local, archivo.datos);

    // Y su entrada en el índice del final, que es por donde empieza a leer
    // cualquier descompresor.
    const entrada = new Uint8Array(46 + nombre.length);
    const vEntrada = new DataView(entrada.buffer);
    vEntrada.setUint32(0, 0x02014b50, true);
    vEntrada.setUint16(4, 20, true); // hecho por
    vEntrada.setUint16(6, 20, true); // necesita
    vEntrada.setUint16(8, 0x0800, true);
    vEntrada.setUint16(10, 0, true);
    vEntrada.setUint16(12, hora, true);
    vEntrada.setUint16(14, fecha, true);
    vEntrada.setUint32(16, crc, true);
    vEntrada.setUint32(20, largo, true);
    vEntrada.setUint32(24, largo, true);
    vEntrada.setUint16(28, nombre.length, true);
    vEntrada.setUint16(30, 0, true); // extras
    vEntrada.setUint16(32, 0, true); // comentario
    vEntrada.setUint16(34, 0, true); // disco
    vEntrada.setUint16(36, 0, true); // atributos internos
    vEntrada.setUint32(38, 0, true); // atributos externos
    vEntrada.setUint32(42, offset, true); // dónde empieza este archivo
    entrada.set(nombre, 46);

    central.push(entrada);
    offset += local.length + largo;
  }

  const tamañoIndice = central.reduce((n, e) => n + e.length, 0);

  // El cierre: dice cuántos archivos hay y dónde está el índice.
  const fin = new Uint8Array(22);
  const vFin = new DataView(fin.buffer);
  vFin.setUint32(0, 0x06054b50, true);
  vFin.setUint16(4, 0, true);
  vFin.setUint16(6, 0, true);
  vFin.setUint16(8, archivos.length, true);
  vFin.setUint16(10, archivos.length, true);
  vFin.setUint32(12, tamañoIndice, true);
  vFin.setUint32(16, offset, true);
  vFin.setUint16(20, 0, true);

  return new Blob([...partes, ...central, fin], { type: 'application/zip' });
}
