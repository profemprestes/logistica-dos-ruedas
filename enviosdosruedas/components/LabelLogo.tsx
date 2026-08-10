/**
 * Insignia redonda para la etiqueta térmica, en blanco y negro.
 *
 * Sigue la forma del logo real —círculo con borde a rayas y el nombre en dos
 * líneas— pero dibujada en vectores: la impresora es monocromo y el .webp con
 * colores sale reticulado y gris. Acá el negro es macizo y el texto va calado
 * en blanco, que es lo que mejor imprime en papel térmico.
 */
export default function LabelLogo({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 100 100"
      style={{ height: `${size}mm`, width: `${size}mm`, display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Envíos DosRuedas"
    >
      {/* borde a rayas, como el del logo */}
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke="#000"
        strokeWidth="7"
        strokeDasharray="6 4"
      />

      {/* disco negro: el texto va calado en blanco */}
      <circle cx="50" cy="50" r="39" fill="#000" />

      <text
        x="50"
        y="42"
        textAnchor="middle"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="19"
        fontWeight="900"
        letterSpacing="0.5"
        fill="#fff"
      >
        ENVÍOS
      </text>
      <text
        x="50"
        y="62"
        textAnchor="middle"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="16"
        fontWeight="900"
        letterSpacing="-0.5"
        fill="#fff"
      >
        DosRuedas
      </text>
      <text
        x="50"
        y="78"
        textAnchor="middle"
        fontFamily="Arial, sans-serif"
        fontSize="11"
        fontWeight="700"
        letterSpacing="2"
        fill="#fff"
      >
        MDQ
      </text>
    </svg>
  );
}
