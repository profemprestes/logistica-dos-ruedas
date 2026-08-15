import { GoogleAuth } from 'google-auth-library';

/**
 * El envío de avisos a la app de Android.
 *
 * Corre SÓLO en el servidor: la clave que firma los mensajes no puede pisar el
 * navegador ni por accidente. Por eso vive en `lib/server/`.
 *
 * Es el hermano de `web-push`, que es lo que se usa para los navegadores. Los
 * dos hacen lo mismo desde afuera —avisarle algo a un celular— por caminos que
 * no se tocan: distinta credencial, distinto destinatario guardado en la base y
 * distintos errores cuando algo falla.
 */

/**
 * La credencial sale de una variable de entorno con el JSON entero adentro.
 *
 * Es el archivo que Firebase da en "Cuentas de servicio → Generar nueva clave
 * privada". NO va al repositorio: con eso cualquiera manda notificaciones en
 * nombre de la empresa.
 */
const VARIABLE = 'FIREBASE_SERVICE_ACCOUNT';

interface Cuenta {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cuenta: Cuenta | null | undefined;

function leerCuenta(): Cuenta | null {
  if (cuenta !== undefined) return cuenta;

  const crudo = process.env[VARIABLE];
  if (!crudo) {
    cuenta = null;
    return null;
  }

  try {
    const json = JSON.parse(crudo) as Partial<Cuenta>;
    if (!json.project_id || !json.client_email || !json.private_key) {
      console.error(`[fcm] ${VARIABLE} está pero le faltan campos.`);
      cuenta = null;
      return null;
    }

    /*
     * Los saltos de línea de la clave.
     *
     * El JSON trae la clave privada con "\n" adentro de un texto. Según cómo se
     * haya pegado la variable —a mano en Vercel, en un .env— pueden llegar como
     * dos caracteres en vez de un salto real, y ahí la firma falla con un error
     * que no dice nada ("error:1E08010C"). Se normaliza siempre: si ya estaban
     * bien, esto no cambia nada.
     */
    json.private_key = json.private_key.replace(/\\n/g, '\n');

    cuenta = json as Cuenta;
    return cuenta;
  } catch {
    console.error(`[fcm] ${VARIABLE} no es un JSON válido.`);
    cuenta = null;
    return null;
  }
}

/** ¿Está configurado? Si no, el envío a la app se saltea sin romper nada. */
export function hayFirebase(): boolean {
  return leerCuenta() !== null;
}

let auth: GoogleAuth | null = null;

/**
 * El permiso para hablarle a Firebase.
 *
 * `GoogleAuth` se guarda entre llamadas porque cachea el token de acceso, que
 * dura una hora. Sin eso, cada notificación pagaría un viaje de ida y vuelta a
 * Google antes de siquiera empezar.
 */
async function token(): Promise<string | null> {
  const c = leerCuenta();
  if (!c) return null;

  auth ??= new GoogleAuth({
    credentials: { client_email: c.client_email, private_key: c.private_key },
    scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
  });

  const t = await auth.getAccessToken();
  return typeof t === 'string' ? t : null;
}

/** Lo que le pasó a un token al intentar mandarle algo. */
export type ResultadoFcm = 'ok' | 'vencido' | 'error';

/**
 * Manda un aviso a un celular.
 *
 * EL MENSAJE VA CON LAS DOS PARTES, y no es de más:
 *
 *  - `notification` es lo que hace que Android dibuje el aviso solo, con la app
 *    cerrada. Sin esto no llega nada cuando más importa.
 *  - `data` es lo que la app lee al tocarlo para saber a qué pantalla ir.
 */
export async function mandarAvisoFcm(
  destino: string,
  aviso: { title: string; body: string; url: string; tag?: string },
): Promise<ResultadoFcm> {
  const c = leerCuenta();
  const acceso = await token();
  if (!c || !acceso) return 'error';

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${acceso}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: destino,
            notification: { title: aviso.title, body: aviso.body },
            data: { url: aviso.url },
            android: {
              priority: 'HIGH',
              notification: {
                // El mismo `tag` que en el navegador: el aviso nuevo pisa al
                // anterior en vez de apilar diez iguales.
                tag: aviso.tag ?? 'edr',
                icon: 'ic_launcher',
                color: '#0636A5',
                sound: 'default',
              },
            },
          },
        }),
      },
    );

    if (res.ok) return 'ok';

    /*
     * 404 = el token ya no existe: desinstalaron la app o Firebase lo renovó.
     * 403 = la credencial no tiene permiso, o es de otro proyecto. Eso NO es un
     * token vencido y borrarlo sería perder el celular por un error nuestro.
     */
    if (res.status === 404) return 'vencido';

    const detalle = await res.text().catch(() => '');
    console.error('[fcm] rechazado', res.status, detalle.slice(0, 300));
    return 'error';
  } catch (err) {
    console.error('[fcm] no se pudo enviar', err);
    return 'error';
  }
}
