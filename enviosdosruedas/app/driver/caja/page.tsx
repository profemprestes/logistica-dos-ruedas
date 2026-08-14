import { redirect } from 'next/navigation';

/**
 * La caja del día todavía no tiene pantalla propia.
 *
 * La barra de abajo ya la ofrece porque es una de las cinco secciones del
 * rediseño, y hasta que exista se manda a donde está hoy ese dato: el perfil.
 * Mejor eso que un botón que lleva a un error, o que una sección menos que
 * después hay que volver a acomodar.
 */
export default function CajaPage() {
  redirect('/driver/profile');
}
