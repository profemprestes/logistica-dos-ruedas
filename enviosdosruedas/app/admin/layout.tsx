import type { ReactNode } from 'react';
import { ProveedorDelDia } from '@/components/admin/DatosDelDia';
import AdminShell from '@/components/admin/AdminShell';

/**
 * El marco es de todo el panel, no de cada pantalla.
 *
 * Antes cada sección dibujaba su propia barra de navegación. Nueve copias del
 * mismo encabezado significan nueve lugares donde arreglar cualquier cosa, y
 * significan también que al cambiar de sección la barra se vuelve a dibujar
 * entera. Acá se dibuja una vez y lo único que cambia es el contenido.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ProveedorDelDia>
      <AdminShell>{children}</AdminShell>
    </ProveedorDelDia>
  );
}
