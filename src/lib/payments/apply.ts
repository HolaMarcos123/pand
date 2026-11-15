import { Prisma } from "@/generated/prisma/client";

/**
 * Imputación de cobros: la única.
 *
 * Vive acá y no dentro del importador porque hay dos entradas de plata —la planilla
 * de cobros y el modal de la bandeja— y si cada una tuviera su propia aritmética,
 * tarde o temprano dejarían el mismo cobro en estados distintos. La regla de negocio
 * de "cómo baja una deuda" tiene que existir una sola vez.
 */

/** Subconjunto de Prisma que necesitan estas funciones dentro de una transacción. */
type Tx = Prisma.TransactionClient;

export type Allocation = {
  allocated: Prisma.Decimal;
  remaining: Prisma.Decimal;
  /** Primer comprobante tocado, para dejarlo referenciado en el Payment. */
  firstInvoiceId: string | null;
};

/**
 * Aplica `amount` sobre los comprobantes abiertos del deudor.
 *
 * Orden: primero los comprobantes que el usuario eligió explícitamente —sea por
 * número en la planilla o por checkbox en el modal—, después el resto por
 * vencimiento más viejo primero (FIFO). Bajar primero lo más viejo es lo que hace
 * cualquier área de cobranzas: descarga la mora que más pesa en los tramos.
 *
 * Si sobra plata, se devuelve en `remaining`: quien llama decide qué hacer. Nunca se
 * inventa un comprobante para absorberla.
 */
export async function allocateToInvoices(
  tx: Tx,
  params: {
    organizationId: string;
    clientId: string;
    amount: Prisma.Decimal | number;
    preferredInvoiceIds?: string[];
    preferredInvoiceNumbers?: string[];
  },
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

  const preferredIds = new Set(params.preferredInvoiceIds ?? []);
  const preferredNumbers = new Set(params.preferredInvoiceNumbers ?? []);
  const isPreferred = (invoice: (typeof open)[number]) =>
    preferredIds.has(invoice.id) || preferredNumbers.has(invoice.invoiceNumber);

  const ordered =
    preferredIds.size || preferredNumbers.size
      ? [...open.filter(isPreferred), ...open.filter((i) => !isPreferred(i))]
      : open;

  let remaining = new Prisma.Decimal(params.amount);
  let allocated = new Prisma.Decimal(0);
  let firstInvoiceId: string | null = null;

  for (const invoice of ordered) {
    if (remaining.lessThanOrEqualTo(0)) break;

    const due = invoice.amount.minus(invoice.paidAmount);
    if (due.lessThanOrEqualTo(0)) continue;

    const toApply = remaining.lessThan(due) ? remaining : due;
    const newPaid = invoice.paidAmount.plus(toApply);

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: newPaid,
        status: newPaid.greaterThanOrEqualTo(invoice.amount) ? "PAID" : "PARTIAL",
      },
    });

    remaining = remaining.minus(toApply);
    allocated = allocated.plus(toApply);
    firstInvoiceId ??= invoice.id;
  }

  return { allocated, remaining, firstInvoiceId };
}

/**
 * Deja al deudor consistente con sus comprobantes: recalcula la deuda y, si no le
 * queda nada abierto, lo pasa a PAID —con lo cual desaparece de la bandeja.
 *
 * Va en SQL porque Prisma no puede agregar sobre una expresión (`amount - paid_amount`)
 * y hacerlo en JavaScript obligaría a traer todos los comprobantes solo para sumarlos.
 */
export async function refreshClientBalance(
  tx: Tx,
  organizationId: string,
  clientId: string,
): Promise<void> {
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
     WHERE c.id = ${clientId}::uuid
       AND c.organization_id = ${organizationId}::uuid
  `;
}
