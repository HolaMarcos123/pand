import { Prisma } from "@/generated/prisma/client";

/**
 * Imputación de cobros: la única.
 *
 * Vive acá y no dentro del importador porque hay dos entradas de plata —la planilla
 * de cobros y el modal de la bandeja— y si cada una tuviera su propia aritmética,
 * tarde o temprano dejarían el mismo cobro en estados distintos. La regla de negocio
 * de "cómo baja una deuda" tiene que existir una sola vez.
 *
 * Por eso el cálculo está separado de la escritura. `planificarImputacion` no toca
 * la base: recibe los comprobantes abiertos y devuelve qué habría que escribir. El
 * modal la usa a través de `allocateToInvoices`, que carga y escribe de a un cobro;
 * el importador la llama de a cientos sobre comprobantes que ya tiene en memoria y
 * escribe todo junto al final. Dos formas de escribir, una sola aritmética.
 */

/** Subconjunto de Prisma que necesitan estas funciones dentro de una transacción. */
type Tx = Prisma.TransactionClient;

/** Un comprobante con deuda, como lo necesita el cálculo. */
export type OpenInvoice = {
  id: string;
  invoiceNumber: string;
  amount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
};

/** Lo que hay que escribir sobre un comprobante. */
export type InvoiceChange = {
  invoiceId: string;
  /** Total pagado después de aplicar el cobro, no lo que se aplicó ahora. */
  paidAmount: Prisma.Decimal;
  status: "PAID" | "PARTIAL";
};

export type Allocation = {
  allocated: Prisma.Decimal;
  remaining: Prisma.Decimal;
  /** Primer comprobante tocado, para dejarlo referenciado en el Payment. */
  firstInvoiceId: string | null;
};

export type AllocationPlan = Allocation & {
  changes: InvoiceChange[];
};

export type AllocationParams = {
  amount: Prisma.Decimal | number;
  preferredInvoiceIds?: string[];
  preferredInvoiceNumbers?: string[];
};

/**
 * Decide cómo baja una deuda. No toca la base.
 *
 * Orden: primero los comprobantes que el usuario eligió explícitamente —sea por
 * número en la planilla o por checkbox en el modal—, después el resto por
 * vencimiento más viejo primero (FIFO). Bajar primero lo más viejo es lo que hace
 * cualquier área de cobranzas: descarga la mora que más pesa en los tramos.
 *
 * `open` tiene que venir ordenado por vencimiento ascendente, porque de ahí sale el
 * FIFO. Un comprobante ya saldado se saltea, así que quien procesa varios cobros
 * seguidos del mismo deudor puede ir actualizando `paidAmount` en memoria y el
 * segundo cobro ve lo que dejó el primero.
 *
 * Si sobra plata, se devuelve en `remaining`: quien llama decide qué hacer. Nunca se
 * inventa un comprobante para absorberla.
 */
export function planificarImputacion(
  open: OpenInvoice[],
  params: AllocationParams,
): AllocationPlan {
  const preferredIds = new Set(params.preferredInvoiceIds ?? []);
  const preferredNumbers = new Set(params.preferredInvoiceNumbers ?? []);
  const isPreferred = (invoice: OpenInvoice) =>
    preferredIds.has(invoice.id) || preferredNumbers.has(invoice.invoiceNumber);

  const ordered =
    preferredIds.size || preferredNumbers.size
      ? [...open.filter(isPreferred), ...open.filter((i) => !isPreferred(i))]
      : open;

  let remaining = new Prisma.Decimal(params.amount);
  let allocated = new Prisma.Decimal(0);
  let firstInvoiceId: string | null = null;
  const changes: InvoiceChange[] = [];

  for (const invoice of ordered) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const due = invoice.amount.minus(invoice.paidAmount);
    if (due.lessThanOrEqualTo(0)) continue;

    const toApply = remaining.lessThan(due) ? remaining : due;
    const newPaid = invoice.paidAmount.plus(toApply);

    changes.push({
      invoiceId: invoice.id,
      paidAmount: newPaid,
      status: newPaid.greaterThanOrEqualTo(invoice.amount) ? "PAID" : "PARTIAL",
    });

    remaining = remaining.minus(toApply);
    allocated = allocated.plus(toApply);
    firstInvoiceId ??= invoice.id;
  }

  return { allocated, remaining, firstInvoiceId, changes };
}

/**
 * Aplica `amount` sobre los comprobantes abiertos del deudor y los escribe.
 *
 * Es el camino de un cobro suelto: el modal de la bandeja. Carga, calcula con
 * `planificarImputacion` y escribe los uno o dos comprobantes que tocó.
 */
export async function allocateToInvoices(
  tx: Tx,
  params: AllocationParams & { organizationId: string; clientId: string },
): Promise<Allocation> {
  const open = await tx.invoice.findMany({
    where: {
      organizationId: params.organizationId,
      clientId: params.clientId,
      status: { in: ["PENDING", "PARTIAL"] },
    },
    orderBy: { dueDate: "asc" },
    select: { id: true, amount: true, paidAmount: true, invoiceNumber: true },
  });

  const plan = planificarImputacion(open, params);

  for (const cambio of plan.changes) {
    await tx.invoice.update({
      where: { id: cambio.invoiceId },
      data: { paidAmount: cambio.paidAmount, status: cambio.status },
    });
  }

  return {
    allocated: plan.allocated,
    remaining: plan.remaining,
    firstInvoiceId: plan.firstInvoiceId,
  };
}

/**
 * Deja al deudor consistente con sus comprobantes: recalcula la deuda y, si no le
 * queda nada abierto, lo pasa a PAID —con lo cual desaparece de la bandeja.
 *
 * Va en SQL porque Prisma no puede agregar sobre una expresión (`amount - paid_amount`)
 * y hacerlo en JavaScript obligaría a traer todos los comprobantes solo para sumarlos.
 *
 * Toma una lista de deudores y no uno: el importador cierra cientos de cobros en un
 * lote y llamarla por deudor era un viaje a la base por fila. Para un solo deudor,
 * `refreshClientBalance` es el atajo.
 */
export async function refreshClientBalances(
  tx: Tx,
  organizationId: string,
  clientIds: string[],
): Promise<void> {
  if (clientIds.length === 0) return;

  await tx.$executeRaw`
    UPDATE clients c
       SET total_debt = COALESCE((
             SELECT SUM(i.amount - i.paid_amount)
               FROM invoices i
              WHERE i.client_id = c.id
                AND i.status IN ('PENDING', 'PARTIAL')
           ), 0),
           -- Quedarse sin comprobantes abiertos NO es lo mismo que haber pagado.
           -- La regla anterior marcaba "Pagado" a un deudor al que le castigaron
           -- toda la deuda, que es justo el caso contrario. El castigo gana sobre
           -- el pago: con una sola deuda castigada el deudor no cumplió.
           status = CASE
                      WHEN EXISTS (
                        SELECT 1 FROM invoices i
                         WHERE i.client_id = c.id
                           AND i.status IN ('PENDING', 'PARTIAL')
                      ) THEN c.status
                      WHEN EXISTS (
                        SELECT 1 FROM invoices i
                         WHERE i.client_id = c.id
                           AND i.status = 'WRITTEN_OFF'
                      ) THEN 'LOST'::"ClientStatus"
                      WHEN EXISTS (
                        SELECT 1 FROM invoices i
                         WHERE i.client_id = c.id
                           AND i.status = 'PAID'
                      ) THEN 'PAID'::"ClientStatus"
                      -- Solo refinanciados o anulados: la deuda se movió a otro
                      -- lado o no debió existir. El estado del deudor no cambia.
                      ELSE c.status
                    END,
           updated_at = now()
     WHERE c.id = ANY(${clientIds}::uuid[])
       AND c.organization_id = ${organizationId}::uuid
  `;
}

/** Un solo deudor. Mismo cálculo que `refreshClientBalances`. */
export async function refreshClientBalance(
  tx: Tx,
  organizationId: string,
  clientId: string,
): Promise<void> {
  await refreshClientBalances(tx, organizationId, [clientId]);
}
