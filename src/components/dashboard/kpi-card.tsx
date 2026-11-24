import { cn } from "@/lib/utils";

/**
 * La card de un KPI, al modo del visual "Tarjeta" de Power BI.
 *
 * Etiqueta chica arriba, la cifra grande debajo y el contexto al pie. El orden
 * no es estético: la cifra tiene que caer siempre a la misma altura en las tres
 * cards de una fila, y para eso la etiqueta va arriba y de una sola línea.
 *
 * La cifra va en Geist Mono con cifras tabulares. Es lo que hace que tres
 * importes en guaraníes apilados en una fila tengan el mismo ancho por dígito y
 * se puedan comparar de un vistazo en lugar de leerlos de a uno.
 *
 * `critical` invierte el fondo a celeste. El manual reserva ese tratamiento para
 * UN indicador por pantalla —la mora +90—: si se pintan dos, deja de señalar.
 */
export function KpiCard({
  label,
  value,
  hint,
  critical = false,
}: {
  label: string;
  value: string;
  hint?: string;
  critical?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[116px] flex-col justify-between rounded-card p-5 shadow-panel",
        critical ? "bg-pand-celeste" : "bg-white",
      )}
    >
      <p
        className={cn(
          "etiqueta truncate",
          // `.etiqueta` ya trae el gris; sobre celeste hay que pisarlo porque el
          // gris de Pand sobre celeste no llega al contraste mínimo.
          critical && "text-pand-contorno/75",
        )}
        title={label}
      >
        {label}
      </p>

      {/* Tamaño fluido y no fijo en 30px: un importe en guaraníes son quince
          caracteres, y a 30px no entra en el ancho que tiene una card cuando la
          fila de tres se dibuja en un portátil de 1024 o 1280 px. Se partía en
          dos líneas justo en el dato más importante de la pantalla. El clamp lo
          baja hasta 22px y lo sube hasta 30px en un monitor ancho. */}
      <p className="cifra mt-3 text-[clamp(22px,1.9vw,30px)] font-semibold leading-[1.2] text-pand-contorno">
        {value}
      </p>

      {hint && (
        <p
          className={cn(
            "mt-1.5 text-xs leading-4",
            critical ? "text-pand-contorno/75" : "text-pand-gris",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
