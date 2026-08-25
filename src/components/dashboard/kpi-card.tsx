import { cn } from "@/lib/utils";

/**
 * Card de KPI del manual: label chico en mayúsculas, cifra grande en JetBrains Mono.
 *
 * `critical` invierte el fondo a celeste. El manual reserva ese tratamiento para UN
 * indicador por pantalla —la mora +90—: si se pintan dos, deja de señalar nada.
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
        "rounded-card p-5 shadow-card",
        critical ? "bg-pand-celeste" : "bg-white",
      )}
    >
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wider",
          critical ? "text-pand-contorno/70" : "text-pand-gris",
        )}
      >
        {label}
      </p>

      <p className="mono mt-3 text-[28px] font-medium leading-[34px] text-pand-contorno">
        {value}
      </p>

      {hint && (
        <p
          className={cn(
            "mt-1 text-xs",
            critical ? "text-pand-contorno/70" : "text-pand-gris",
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
