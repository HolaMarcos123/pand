import type { InvoiceStatus } from "@/generated/prisma/enums";

/**
 * Los estados de un comprobante, con nombre y con significado contable.
 *
 * Existe como catálogo y no como un `switch` en cada pantalla porque la pregunta
 * "¿esto todavía es cartera?" se responde en varios lugares —el saldo del deudor,
 * los tramos, el dashboard, los reportes— y tiene que contestarse igual en todos.
 */
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagado",
  CANCELLED: "Anulado",
  REFINANCED: "Refinanciado",
  WRITTEN_OFF: "Castigado",
};

/** Cómo se pinta cada estado. Solo el castigo y la mora usan coral. */
export const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  PENDING: "text-pand-gris",
  PARTIAL: "text-pand-gris",
  PAID: "text-pand-gris",
  CANCELLED: "text-pand-gris",
  REFINANCED: "text-pand-azul",
  WRITTEN_OFF: "text-pand-coral",
};

/**
 * Estados que un supervisor puede poner a mano, y qué significan.
 *
 * El operador no está: castigar una deuda o declararla refinanciada la saca de la
 * cartera activa y del indicador de recupero del que depende su propio bono. Es una
 * decisión de quien responde por la cartera, no de quien la gestiona.
 */
export type ManualInvoiceStatus =
  | "PENDING"
  | "REFINANCED"
  | "WRITTEN_OFF"
  | "CANCELLED";

export const MANUAL_INVOICE_STATUSES: {
  value: ManualInvoiceStatus;
  label: string;
  hint: string;
}[] = [
  {
    value: "PENDING",
    label: "Volver a cartera",
    hint: "Deshace el refinanciado, el castigo o la anulación y lo devuelve a la cartera activa.",
  },
  {
    value: "REFINANCED",
    label: "Refinanciado",
    hint: "La deuda se reemplazó por otra. Sale de la cartera activa sin estar pagada.",
  },
  {
    value: "WRITTEN_OFF",
    label: "Castigado",
    hint: "Contablemente ya no es activo, pero se sigue pudiendo recuperar. No suma al saldo.",
  },
  {
    value: "CANCELLED",
    label: "Anulado",
    hint: "El comprobante no debió existir: error de carga, nota de crédito total.",
  },
];

/**
 * Los estados que siguen siendo cartera cobrable.
 *
 * Este array es el que va a las consultas; `esCarteraActiva` es el mismo criterio
 * para TypeScript. Tenerlos derivados uno del otro es lo que evita que una pantalla
 * cuente el castigo como deuda viva y otra no.
 */
export const ESTADOS_ABIERTOS = ["PENDING", "PARTIAL"] as const satisfies readonly InvoiceStatus[];

/** Un comprobante castigado o refinanciado ya no es cartera cobrable. */
export function esCarteraActiva(status: InvoiceStatus): boolean {
  return (ESTADOS_ABIERTOS as readonly InvoiceStatus[]).includes(status);
}
