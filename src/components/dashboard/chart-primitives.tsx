import { cn } from "@/lib/utils";

/**
 * Las convenciones de los visuales de Pand, en un solo lugar.
 *
 * Están sacadas de cómo arma los gráficos Power BI, que es la herramienta con la
 * que el equipo de cobranzas ya lee sus números todos los días. La gracia no es
 * parecerse: es que alguien que viene de un reporte de Power BI no tenga que
 * aprender a leer de nuevo. En concreto:
 *
 *   · **Marco del visual.** Título arriba a la izquierda, subtítulo debajo en
 *     gris, el dato abajo. Nada de títulos centrados: el ojo arranca siempre en
 *     la misma esquina y recorrer ocho visuales es un movimiento, no ocho.
 *   · **Grilla horizontal y nada más.** Sin grilla vertical, sin líneas de eje,
 *     sin marcas de tick. La tinta está en las barras.
 *   · **Etiquetas de dato sobre la barra.** Es lo que vuelve innecesario estimar
 *     contra el eje, y es la diferencia entre un gráfico lindo y uno con el que
 *     se puede trabajar.
 *   · **Cards planas.** Separadas por un hairline, no por una sombra: con ocho
 *     visuales en pantalla las sombras hacen ruido.
 *
 * Los colores van en hexadecimal y no como hsl(var(--chart-1)). No es un
 * descuido: recharts los escribe como atributos de presentación del SVG, y ahí
 * var() no se resuelve —el elemento queda sin pintar—. Son los mismos valores
 * que los tokens --chart-* de globals.css y tienen que moverse juntos.
 */

// ───────────────────────── Paleta ─────────────────────────

/** Serie por serie, en orden. La 1 es la principal; "alerta" significa que algo está mal. */
export const SERIES = {
  principal: "#006AFF", // pand.azul
  comparacion: "#7BE1FF", // pand.celeste
  alerta: "#F4707C", // pand.coral
  profundo: "#0047A8",
  neutro: "#6E6E78", // pand.gris
  petroleo: "#34A0B8",
} as const;

export const SERIES_EN_ORDEN = [
  SERIES.principal,
  SERIES.comparacion,
  SERIES.profundo,
  SERIES.petroleo,
  SERIES.neutro,
  SERIES.alerta,
] as const;

/**
 * Rampa para los tramos de mora.
 *
 * Los tramos son una escala ordenada —al día, 1-30, 31-60, 61-90, pre-legal,
 * legal—, no seis categorías sueltas. Una escala ordenada se pinta con un solo
 * tono que se va oscureciendo, no con seis colores distintos: así la forma del
 * gráfico dice "esto empeora hacia la derecha" sin que haya que leer el eje.
 *
 * Seis colores para seis tramos es el error clásico del dashboard de cobranzas:
 * se ve más colorido y se entiende menos.
 */
export const RAMPA_MORA: Record<string, string> = {
  AL_DIA: "#9FE9FF",
  T1_30: "#6FD6F7",
  T31_60: "#3FB4F2",
  T61_90: "#1A8CF5",
  PRE_LEGAL: "#006AFF",
  LEGAL: "#0047A8",
  CASTIGO: "#6E6E78",
};

export const TINTA = {
  eje: "#8A8A94",
  grilla: "#E6E9EE",
  dato: "#2A2A35",
  cursor: "#F6F8FB",
} as const;

// ───────────────────────── Ejes y grilla ─────────────────────────

/** Eje de categorías (abajo). Sin línea ni marcas: la grilla ya ubica. */
export const EJE_CATEGORIA = {
  tickLine: false,
  axisLine: false,
  tick: { fill: TINTA.eje, fontSize: 11 },
  dy: 4,
} as const;

/** Eje de valores (izquierda). */
export const EJE_VALOR = {
  tickLine: false,
  axisLine: false,
  tick: { fill: TINTA.eje, fontSize: 11 },
  width: 56,
} as const;

/** Grilla horizontal, tenue y continua. Vertical nunca: no aporta y ensucia. */
export const GRILLA = {
  horizontal: true,
  vertical: false,
  stroke: TINTA.grilla,
  strokeDasharray: "0",
} as const;

/** El estilo de la etiqueta que va sobre cada barra. */
export const ETIQUETA_DATO = {
  position: "top" as const,
  fill: TINTA.dato,
  fontSize: 11,
  fontWeight: 600,
  offset: 8,
};

/**
 * Clases del contenedor del gráfico.
 *
 * Las fuentes se ponen por CSS y no por el prop `tick` de recharts por la misma
 * razón que los colores van en hex: fontFamily termina como atributo del SVG y
 * no resuelve la variable. Por CSS el texto del SVG hereda normalmente.
 *
 * Monoespaciada **solo donde hay números**: el eje de valores y las etiquetas de
 * dato, que es donde alinear por dígito sirve de algo. Las categorías del eje de
 * abajo —"Al día", "Pre-legal"— son palabras y van en la fuente de la interfaz;
 * en mono se leen como si fueran código.
 */
export const LIENZO = [
  "[&_.recharts-surface]:font-sans",
  "[&_.recharts-yAxis_text]:font-mono",
  "[&_.recharts-label-list_text]:font-mono",
].join(" ");

/** Miles y millones cortos para el eje: en guaraníes un número entero no entra. */
export function compacto(valor: number): string {
  return new Intl.NumberFormat("es-PY", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(valor);
}

// ───────────────────────── Marco del visual ─────────────────────────

/**
 * El contenedor de un visual: título, subtítulo, una esquina libre y el cuerpo.
 *
 * Existe para que los visuales de una pantalla tengan el encabezado en el mismo
 * lugar y del mismo tamaño. Cuando cada gráfico se dibuja su propio encabezado a
 * mano, a la tercera pantalla ya hay tres tamaños de título.
 */
export function VisualCard({
  titulo,
  subtitulo,
  accion,
  children,
  className,
  bodyClassName,
}: {
  titulo: string;
  subtitulo?: React.ReactNode;
  /** Esquina superior derecha: un filtro, una leyenda, un total al margen. */
  accion?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-card bg-white shadow-panel", className)}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold leading-5 text-pand-contorno">
            {titulo}
          </h3>
          {subtitulo && (
            <p className="mt-0.5 text-xs leading-4 text-pand-gris">{subtitulo}</p>
          )}
        </div>
        {accion && <div className="shrink-0">{accion}</div>}
      </header>

      <div className={cn("px-2 pb-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Leyenda propia, dibujada como HTML y no con el Legend de recharts.
 *
 * La de recharts vive dentro del SVG, así que no se puede truncar, no envuelve
 * bien y se come alto del gráfico. En HTML es un flex y se comporta.
 */
export function LeyendaVisual({
  series,
}: {
  series: { label: string; color: string }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {series.map((serie) => (
        <li
          key={serie.label}
          className="flex items-center gap-1.5 text-xs text-pand-gris"
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ backgroundColor: serie.color }}
          />
          {serie.label}
        </li>
      ))}
    </ul>
  );
}

type FilaTooltip = {
  name?: string | number;
  value?: unknown;
  color?: string;
};

/**
 * Tooltip al modo Power BI: la categoría en negrita arriba y una fila por serie,
 * con el cuadradito del color a la izquierda.
 *
 * Es un componente propio y no `contentStyle` porque lo que importa es la
 * estructura —cuadradito, nombre, valor alineado a la derecha—, y eso no se
 * consigue con estilos sobre el tooltip de fábrica.
 */
export function TooltipVisual({
  active,
  payload,
  label,
  formatoValor,
  prefijoEtiqueta,
}: {
  active?: boolean;
  payload?: FilaTooltip[];
  label?: string | number;
  formatoValor: (valor: number) => string;
  /** "Tramo", "Mes", "Operador": lo que es la categoría. */
  prefijoEtiqueta?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-card border border-pand-border bg-white px-3 py-2 shadow-panel">
      <p className="text-xs font-semibold text-pand-contorno">
        {prefijoEtiqueta ? `${prefijoEtiqueta} ${label}` : label}
      </p>

      <ul className="mt-1.5 space-y-1">
        {payload.map((fila, i) => (
          <li
            key={`${fila.name ?? i}`}
            className="flex items-center justify-between gap-6 text-xs"
          >
            <span className="flex items-center gap-1.5 text-pand-gris">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: fila.color }}
              />
              {fila.name}
            </span>
            <span className="mono font-semibold text-pand-contorno">
              {formatoValor(Number(fila.value ?? 0))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
