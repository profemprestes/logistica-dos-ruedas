/** Posición del celular en el momento de cerrar un envío. */
export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Pide la posición actual. Nunca tira error: si no la consigue devuelve null,
 * porque el repartidor no puede quedar trabado en un sótano sin señal de GPS.
 */
export function getFix(timeoutMs = 12_000): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}
