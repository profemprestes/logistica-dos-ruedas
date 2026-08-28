/**
 * Qué significa cada columna del archivo de cada comercio.
 *
 * Cada uno manda la hoja de ruta que le escupe su sistema, con sus nombres de
 * columna y sus mañas. La plantilla es la traducción: "la columna que se llama
 * CLIENTE es el destinatario". Nada más que eso.
 *
 * ESTÁN EN CÓDIGO Y NO EN LA BASE A PROPÓSITO, por ahora. Hay una sola y hasta
 * no tener la segunda no se sabe qué se repite y qué no; escribir la pantalla
 * de alta de plantillas antes de eso es adivinar. Lo que sí está pensado es que
 * se puedan mover: los títulos y los campos son datos sueltos, y los arreglos
 * de formato son nombres —no funciones— justamente para que un día entren en
 * una fila de Supabase sin reescribir esto.
 */

/** A qué campo del envío va una columna. `ignorar` es una decisión, no un olvido. */
export type Campo =
  | 'destinatario'
  | 'direccion'
  | 'piso'
  | 'puerta'
  | 'telefono'
  | 'cantidad'
  | 'producto'
  | 'horario'
  | 'ignorar';

/**
 * Arreglos del formato propio de un comercio, por nombre.
 *
 * - `cola-geografica`: la dirección viene con el partido, la provincia, el
 *   código postal y el país pegados atrás. "VIAMONTE 2035, GRAL PUEYRREDON,
 *   BUENOS AIRES 7600 Argentina" es Viamonte 2035, y todo lo demás sobra: el
 *   buscador de puntos se pierde con eso adentro.
 * - `tipo-de-calle-al-final`: el sistema de FLOW escribe el tipo de calle
 *   después del nombre y separado por coma —"COLON ,AV. 1899", "ALBERDI JUAN B
 *   ,DIAG. 2550"—. Así no lo encuentra nadie; van dados vuelta.
 */
export type Arreglo = 'cola-geografica' | 'tipo-de-calle-al-final';

export interface Plantilla {
  /** Cómo se la nombra en la pantalla. */
  id: string;
  nombre: string;
  /** El comercio al que se cargan los envíos, tal cual se llama su ficha. */
  comercio: string;
  /**
   * De dónde se retira, cuando el archivo no lo dice.
   *
   * La hoja de ruta trae a dónde va cada paquete, nunca de dónde sale: eso lo
   * sabe el comercio y no hace falta escribirlo trece veces. Sin esto los trece
   * envíos entran sin punto de retiro y el repartidor no lo ve en el mapa.
   */
  retiroFijo?: string;
  ciudad: string;
  /** La columna que aparece una vez por envío y cierra la fila. Ver `tabla.ts`. */
  ancla: string;
  columnas: { titulo: string; campo: Campo }[];
  arreglos: Arreglo[];
  /** La etiqueta del encabezado que trae la fecha del reparto, si la trae. */
  fechaEn?: string;
}

/**
 * FLOW (CONECTTA), hoja de ruta en PDF.
 *
 * Sacada del archivo del 28/08/2026, trece envíos. "OT" es el número de orden
 * de ellos, que no significa nada de este lado, pero es lo que marca dónde
 * termina cada envío, así que se lee aunque no se guarde. Lo mismo "Entre
 * Calles": Matías pidió no cargarlas.
 */
export const FLOW_CONECTTA: Plantilla = {
  id: 'flow-conectta-pdf',
  nombre: 'Flow (Conectta) — hoja de ruta PDF',
  comercio: 'FLOW (CONECTTA)',
  retiroFijo: 'FRIULI 1972',
  ciudad: 'Mar del Plata',
  ancla: 'OT',
  fechaEn: 'Fecha',
  columnas: [
    { titulo: 'OT', campo: 'ignorar' },
    { titulo: 'CLIENTE', campo: 'destinatario' },
    { titulo: 'DIRECCIÓN', campo: 'direccion' },
    { titulo: 'Piso', campo: 'piso' },
    { titulo: 'Puerta', campo: 'puerta' },
    { titulo: 'Entre Calles', campo: 'ignorar' },
    { titulo: 'TELEFONOS', campo: 'telefono' },
    // El título de la cantidad viene partido en dos renglones, "CA" arriba y
    // "NT." abajo: en la línea del encabezado dice "NT.".
    { titulo: 'NT.', campo: 'cantidad' },
    { titulo: 'ACTIVIDAD', campo: 'producto' },
    { titulo: 'TURNO', campo: 'horario' },
  ],
  arreglos: ['cola-geografica', 'tipo-de-calle-al-final'],
};

export const PLANTILLAS: Plantilla[] = [FLOW_CONECTTA];

export const plantillaPorId = (id: string) => PLANTILLAS.find((p) => p.id === id);
