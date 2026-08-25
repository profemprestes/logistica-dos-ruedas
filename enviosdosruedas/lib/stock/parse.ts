/**
 * Utilidades de texto del stock.
 *
 * ACÁ VIVÍA EL PARSER del mensaje de entregas del día (pestaña "Descargar
 * entregas"), traducido del viejo `stock-edr/server.js`. Se fue con el paso
 * 56: el descuento ya no se adivina desde un texto — cada envío lleva su
 * pedido elegido de un listado, y la base descuenta sola al entregar.
 */

/** Saca acentos, mayúsculas y puntuación: así "Óxido nítrico" matchea "oxido nitrico". */
export function normalizar(txt: unknown): string {
  return String(txt ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCSV(texto: string): string[][] {
  const sinBom = texto.replace(/^﻿/, '');
  // Si la primera línea tiene más ; o tabs que comas, ese es el separador.
  const cabecera = sinBom.split(/\r?\n/)[0] ?? '';
  const cuenta = (c: string) => (cabecera.split(c).length - 1);
  const sep = cuenta(';') > cuenta(',') ? ';' : cuenta('\t') > cuenta(',') ? '\t' : ',';

  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let enComillas = false;

  for (let i = 0; i < sinBom.length; i++) {
    const c = sinBom[i];

    if (enComillas) {
      if (c === '"') {
        if (sinBom[i + 1] === '"') {
          campo += '"';
          i++;
        } else enComillas = false;
      } else campo += c;
      continue;
    }

    if (c === '"') enComillas = true;
    else if (c === sep) {
      fila.push(campo.trim());
      campo = '';
    } else if (c === '\n') {
      fila.push(campo.trim());
      filas.push(fila);
      fila = [];
      campo = '';
    } else if (c !== '\r') campo += c;
  }

  if (campo || fila.length) {
    fila.push(campo.trim());
    filas.push(fila);
  }

  return filas.filter((f) => f.some(Boolean));
}
