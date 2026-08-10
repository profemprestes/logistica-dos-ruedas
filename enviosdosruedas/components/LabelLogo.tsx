/**
 * Marca vectorizada para la etiqueta térmica.
 *
 * Es un dibujo propio, no el .webp del logo: la impresora térmica es monocromo
 * y una imagen con colores y bordes suaves sale reticulada, gris y sucia. Un
 * SVG de trazos negros macizos imprime nítido a cualquier tamaño.
 *
 * Conserva lo reconocible de la marca: las dos ruedas (de MOTO) y el nombre en
 * dos líneas. La rueda va con cubierta gruesa, llanta y cinco rayos anchos:
 * a 13mm de alto, unos rayos finos tipo bicicleta se empastan y no se leen.
 */
export default function LabelLogo({ height = 14 }: { height?: number }) {
  return (
    <svg
      viewBox="0 0 200 56"
      style={{ height: `${height}mm`, width: 'auto', display: 'block' }}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Envíos DosRuedas"
    >
      <Rueda cx={26} cy={30} />
      <Rueda cx={64} cy={30} />

      <text
        x="96"
        y="26"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="21"
        fontWeight="900"
        letterSpacing="1"
        fill="#000"
      >
        ENVÍOS
      </text>
      <text
        x="96"
        y="49"
        fontFamily="Arial Black, Arial, sans-serif"
        fontSize="21"
        fontWeight="900"
        letterSpacing="-0.5"
        fill="#000"
      >
        DosRuedas
      </text>
    </svg>
  );
}

/** Rueda de moto: cubierta ancha, llanta, cinco rayos y maza con disco. */
function Rueda({ cx, cy }: { cx: number; cy: number }) {
  const rayos = [0, 72, 144, 216, 288];

  return (
    <g>
      {/* cubierta: el anillo grueso es lo que la hace leer como moto */}
      <circle cx={cx} cy={cy} r="19" fill="none" stroke="#000" strokeWidth="7" />
      {/* llanta */}
      <circle cx={cx} cy={cy} r="13" fill="none" stroke="#000" strokeWidth="2.5" />

      {/* rayos anchos, tipo llanta de aleación */}
      {rayos.map((grados) => (
        <line
          key={grados}
          x1={cx}
          y1={cy}
          x2={cx + 13 * Math.cos((grados * Math.PI) / 180)}
          y2={cy + 13 * Math.sin((grados * Math.PI) / 180)}
          stroke="#000"
          strokeWidth="4"
          strokeLinecap="round"
        />
      ))}

      {/* maza */}
      <circle cx={cx} cy={cy} r="4.5" fill="#000" />
    </g>
  );
}
