import { z } from "zod";

import { parseAmount, parseDate, parseText } from "@/lib/import/parse-values";
import {
  PAYMENT_FIELDS,
  PAYMENT_METHOD_VALUES,
  parsePaymentMethod,
  type PaymentFieldKey,
} from "@/lib/import/payment-config";
import type { RowError } from "@/lib/import/row-schema";

export const PAYMENT_BATCH_SIZE = 200;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const paymentRowSchema = z
  .object({
    // Se arrastra el número de fila del archivo para poder devolver problemas que el
    // usuario pueda ubicar en su planilla.
    rowNumber: z.number().int().positive(),
    matchExternalId: optionalText(120),
    matchDocument: optionalText(60),
    invoiceNumber: optionalText(120),
    amount: z.number().finite().positive().max(1e15),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida"),
    reference: optionalText(120),
    // Del catálogo, no una copia: agregar un medio de pago no puede dejar de validar.
    method: z.enum(PAYMENT_METHOD_VALUES),
  })
  .refine((row) => row.matchExternalId || row.matchDocument, {
    message: "hace falta el ID o el documento del deudor",
  });

export const paymentBatchSchema = z.object({
  rows: z.array(paymentRowSchema).min(1).max(PAYMENT_BATCH_SIZE),
});

export type PaymentRow = z.infer<typeof paymentRowSchema>;

export type PaymentValidation = {
  valid: PaymentRow[];
  errors: RowError[];
};

/**
 * Convierte las filas del archivo de cobros en filas listas para aplicar.
 *
 * A diferencia de la cartera, acá el monto tiene que ser **positivo**: una planilla
 * de cobros con un negativo es casi siempre una nota de crédito o una devolución
 * mal exportada, y aplicarla como cobro reduciría deuda que nadie pagó.
 */
export function validatePaymentRows(
  rows: Record<string, unknown>[],
  mapping: Partial<Record<PaymentFieldKey, string>>,
): PaymentValidation {
  const valid: PaymentRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((raw, index) => {
    const rowNumber = index + 2;
    const get = (key: PaymentFieldKey) => {
      const column = mapping[key];
      return column ? raw[column] : undefined;
    };

    const label = (key: PaymentFieldKey) =>
      PAYMENT_FIELDS.find((f) => f.key === key)?.label ?? key;

    const amount = parseAmount(get("amount"));
    if (!amount.ok) {
      errors.push({
        row: rowNumber,
        field: label("amount"),
        message: amount.empty ? "vacío" : amount.reason,
      });
      return;
    }
    if (amount.value <= 0) {
      errors.push({
        row: rowNumber,
        field: label("amount"),
        message: "tiene que ser mayor a cero",
      });
      return;
    }

    const date = parseDate(get("paymentDate"));
    if (!date.ok) {
      errors.push({
        row: rowNumber,
        field: label("paymentDate"),
        message: date.empty ? "vacío" : date.reason,
      });
      return;
    }

    const externalId = parseText(get("matchExternalId"));
    const document = parseText(get("matchDocument"));

    if (!externalId.ok && !document.ok) {
      errors.push({
        row: rowNumber,
        field: "Deudor",
        message: "sin ID ni documento, no se puede saber a quién imputar",
      });
      return;
    }

    const invoice = parseText(get("invoiceNumber"));
    const reference = parseText(get("reference"));

    valid.push({
      rowNumber,
      matchExternalId: externalId.ok ? externalId.value : null,
      matchDocument: document.ok ? document.value : null,
      invoiceNumber: invoice.ok ? invoice.value : null,
      amount: amount.value,
      paymentDate: date.value.toISOString().slice(0, 10),
      reference: reference.ok ? reference.value : null,
      method: parsePaymentMethod(get("method")),
    });
  });

  return { valid, errors };
}
