import { Loader2 } from "lucide-react";

import type { PortfolioStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STYLES: Record<PortfolioStatus, { label: string; className: string }> = {
  UPLOADING: { label: "Subiendo", className: "bg-pand-border text-pand-gris" },
  PROCESSING: {
    label: "Procesando",
    className: "bg-pand-celeste/20 text-pand-azul",
  },
  // Verde y no celeste: el celeste ya significa "esto es lo que mirar" en el resto
  // de la app, y acá solo hace falta decir "quedó bien".
  ACTIVE: { label: "Activa", className: "bg-green-100 text-green-700" },
  CLOSED: { label: "Cerrada", className: "bg-pand-bg text-pand-gris" },
};

export function PortfolioStatusBadge({ status }: { status: PortfolioStatus }) {
  const style = STYLES[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-badge px-2 py-0.5 text-xs font-semibold",
        style.className,
      )}
    >
      {status === "PROCESSING" && <Loader2 className="h-3 w-3 animate-spin" />}
      {style.label}
    </span>
  );
}
