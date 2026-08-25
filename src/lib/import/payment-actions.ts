"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import {
  paymentBatchSchema,
  type PaymentRow,
} from "@/lib/import/validate-payments";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export type PaymentOutcome = {
  row: number;
  status: "duplicated" | "not_found" | "ambiguous" | "unapplied";
  detail: string;
};

export type PaymentImportResult =
  | {
      ok: true;
      applied: number;
      duplicated: number;
      /** Plata efectivamente imputada a comprobantes. */
      allocated: number;
      /** Cobros registrados que no encontraron deuda abierta contra la cual imputar. */
      unallocated: number;
      problems: PaymentOutcome[];
    }
  | { ok: false; error: string };

/**
 * Aplica un lote de cobros.
 *
 * Tres decisiones que el brief no define y que cambian el resultado en plata:
 *
 * 1. **Imputación FIFO.** Sin comprobante indicado, el cobro se aplica a los
 *    vencimientos más viejos primero. Es lo que hace cualquier área de cobranzas:
 *    baja primero la mora que más pesa en los tramos.
 *
 * 2. **Deduplicación por referencia.** Si la fila trae referencia y ya existe un
 *    cobro con esa referencia en el tenant, se saltea. Es la única defensa contra
 *    subir dos veces la misma planilla, que duplicaría la plata cobrada y dejaría
 *    facturas pagadas que nadie pagó. Hay además un unique en la base por si el
 *    chequeo se escapa.
 *
 * 3. **Un cobro sin deuda abierta igual se registra.** La plata entró: perderla
 *    porque no había contra qué imputarla sería peor que registrarla y avisar.
 */
export async function importPaymentBatch(input: {
  rows: PaymentRow[];
}): Promise<PaymentImportResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Los operadores no pueden importar cobros." };
  }

  const parsed = paymentBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "El lote llegó con filas inválidas." };
  }

  const organizationId = session.organization.id;
  const currency = session.organization.currency;
  const registeredById = session.user.id;

  let applied = 0;
  let duplicated = 0;
  let allocated = new Prisma.Decimal(0);
  let unallocated = new Prisma.Decimal(0);
  const problems: PaymentOutcome[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const row of parsed.data.rows) {
        // ── 1. Encontrar al deudor ──────────────────────────────
        let clientId: string | null = null;

        if (row.matchExternalId) {
          const found = await tx.client.findFirst({
            where: { organizationId, externalId: row.matchExternalId },
            select: { id: true },
          });
          clientId = found?.id ?? null;
        }

        if (!clientId && row.matchDocument) {
          const matches = await tx.client.findMany({
            where: { organizationId, documentNumber: row.matchDocument },
            select: { id: true },
            take: 2,
          });

          if (matches.length > 1) {
            // El documento no es unico en el schema: dos deudores pueden compartirlo.
            // Adivinar cual es arriesga imputarle el cobro al equivocado.
            problems.push({
              row: row.rowNumber,
              status: "ambiguous",
              detail: `hay más de un deudor con el documento ${row.matchDocument}`,
            });
            continue;
          }

          clientId = matches[0]?.id ?? null;
        }

        if (!clientId) {
          problems.push({
            row: row.rowNumber,
            status: "not_found",
            detail: `no existe el deudor ${row.matchExternalId ?? row.matchDocument}`,
          });
          continue;
        }

        // ── 2. ¿Ya estaba cargado? ──────────────────────────────
        if (row.reference) {
          const existing = await tx.payment.findFirst({
            where: { organizationId, reference: row.reference },
            select: { id: true },
          });

          if (existing) {
            duplicated += 1;
            problems.push({
              row: row.rowNumber,
              status: "duplicated",
              detail: `la referencia ${row.reference} ya estaba cargada`,
            });
            continue;
          }
        }

        // ── 3. Imputar ──────────────────────────────────────────
        const open = await tx.invoice.findMany({
          where: {
            organizationId,
            clientId,
            status: { in: ["PENDING", "PARTIAL"] },
          },
          orderBy: { dueDate: "asc" },
          select: { id: true, amount: true, paidAmount: true, invoiceNumber: true },
        });

        // Si la fila indica un comprobante, ese va primero; el resto queda FIFO.
        const ordered = row.invoiceNumber
          ? [
              ...open.filter((i) => i.invoiceNumber === row.invoiceNumber),
              ...open.filter((i) => i.invoiceNumber !== row.invoiceNumber),
            ]
          : open;

        let remaining = new Prisma.Decimal(row.amount);
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
              status: newPaid.greaterThanOrEqualTo(invoice.amount)
                ? "PAID"
                : "PARTIAL",
            },
          });

          remaining = remaining.minus(toApply);
          firstInvoiceId ??= invoice.id;
        }

        const appliedAmount = new Prisma.Decimal(row.amount).minus(remaining);
        allocated = allocated.plus(appliedAmount);

        if (remaining.greaterThan(0)) {
          unallocated = unallocated.plus(remaining);
          problems.push({
            row: row.rowNumber,
            status: "unapplied",
            detail:
              appliedAmount.equals(0)
                ? "el deudor no tiene comprobantes abiertos; el cobro quedó registrado sin imputar"
                : `sobraron ${remaining.toString()} sin comprobante contra el cual imputar`,
          });
        }

        // ── 4. Registrar el cobro ───────────────────────────────
        await tx.payment.create({
          data: {
            organizationId,
            clientId,
            invoiceId: firstInvoiceId,
            amount: row.amount,
            currency,
            paymentDate: new Date(`${row.paymentDate}T00:00:00Z`),
            paymentMethod: row.method,
            reference: row.reference,
            registeredById,
          },
        });

        applied += 1;

        // ── 5. Dejar al deudor consistente ──────────────────────
        // total_debt sale de los comprobantes abiertos, y si no queda ninguno el
        // deudor pasa a PAID y desaparece de la bandeja.
        await tx.$executeRaw`
          UPDATE clients c
             SET total_debt = COALESCE((
                   SELECT SUM(i.amount - i.paid_amount)
                     FROM invoices i
                    WHERE i.client_id = c.id
                      AND i.status IN ('PENDING', 'PARTIAL')
                 ), 0),
                 status = CASE
                            WHEN NOT EXISTS (
                              SELECT 1 FROM invoices i
                               WHERE i.client_id = c.id
                                 AND i.status IN ('PENDING', 'PARTIAL')
                            ) THEN 'PAID'::"ClientStatus"
                            ELSE c.status
                          END,
                 updated_at = now()
           WHERE c.id = ${clientId}::uuid
             AND c.organization_id = ${organizationId}::uuid
        `;
      }
    },
    // El default de Prisma son 5 segundos: un lote de 200 cobros con varias consultas
    // cada uno los pasa y abortaria la transaccion entera.
    { timeout: 60_000, maxWait: 15_000 },
  );

  revalidatePath("/overview");
  revalidatePath("/portfolio");

  return {
    ok: true,
    applied,
    duplicated,
    allocated: Number(allocated),
    unallocated: Number(unallocated),
    problems,
  };
}
