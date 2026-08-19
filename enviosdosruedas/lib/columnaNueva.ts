/**
 * Pedir una columna que todavía puede no existir.
 *
 * EL PROBLEMA QUE RESUELVE. Los pasos de SQL se corren a mano, así que entre
 * que se publica el código y se corre el paso hay un rato en que la columna
 * nueva no está. Y una consulta de PostgREST que nombra una columna inexistente
 * no devuelve la fila sin ese campo: **falla entera**. En una consulta de
 * lectura de las que sostienen el día —la hoja de ruta del repartidor, el panel
 * de la oficina— eso no es "falta un dato", es la pantalla vacía.
 *
 * Con esto se intenta con la columna y, si la base dice que no existe, se
 * vuelve a pedir sin ella. Se pierde lo nuevo hasta que se corra el paso; no se
 * pierde el trabajo del día.
 *
 * Se le pasa el NOMBRE de la columna a propósito: así un error de verdad —una
 * caída, un permiso— no se confunde con "todavía no la creaste" y sigue
 * saliendo como error, que es lo que hay que ver.
 */
type Respuesta = { data: unknown; error: { message: string } | null };

export async function pidiendo<T>(
  columna: string,
  conLaColumna: () => PromiseLike<Respuesta>,
  sinLaColumna: () => PromiseLike<Respuesta>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const r = await conLaColumna();
  const buena = !r.error || !r.error.message.includes(columna) ? r : await sinLaColumna();
  return { data: (buena.data ?? null) as T | null, error: buena.error };
}
