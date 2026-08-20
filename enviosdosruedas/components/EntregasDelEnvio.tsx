import { comoSeLlama, lasOtras, type Puesto } from '@/lib/entregas';

/**
 * El cartelito de "este envío tiene otra entrega".
 *
 * Lo mismo en el panel, en el celular del repartidor y en el portal del
 * comercio, a propósito: es el aviso que evita que alguien se vaya del local
 * con un paquete de dos, y si cada pantalla lo dijera a su manera habría una
 * donde se lee distinto — que en la práctica es una donde no se lee.
 *
 * Dice el puesto y NOMBRA a las otras. "Entrega 1 de 2" sola no alcanza: hay
 * que poder buscar la otra, verla en la lista y saber si ya salió.
 */
export default function EntregasDelEnvio({
  puesto,
  id,
  /** Con `detalle`, además del chip se listan las otras entregas. */
  detalle = false,
  className = '',
}: {
  puesto: Puesto | undefined;
  id: number;
  detalle?: boolean;
  className?: string;
}) {
  if (!puesto) return null;

  const otras = lasOtras(puesto, id);
  const codigos = otras.map((e) => e.tracking_code).join(', ');

  return (
    <span className={`inline-flex flex-col gap-0.5 align-middle ${className}`}>
      <span
        title={`Un solo envío con ${puesto.total} entregas. Las otras: ${codigos}`}
        className="inline-flex w-fit items-center gap-1 rounded border border-[var(--edr-yellow)] px-1.5 py-0.5 text-[10px] font-black uppercase leading-none text-[var(--edr-acento)]"
      >
        🔗 {comoSeLlama(puesto)}
      </span>

      {detalle && (
        <span className="text-[11px] leading-tight text-[var(--edr-muted)]">
          {/* En la que lleva el precio se dice que lo lleva, y en las otras que
              el precio está en aquélla. Sin esto, una entrega en $ 0 se lee
              como un error de carga. */}
          {puesto.esCabeza
            ? 'Acá va el precio del envío entero. '
            : 'El precio del envío va en la primera entrega. '}
          Va con {codigos}
          {otras.length === 1 && otras[0].address_street ? ` (${otras[0].address_street})` : ''}.
        </span>
      )}
    </span>
  );
}
