import { z } from "zod";

import { idSchema } from "@/lib/validation/id";

/** Cuántas filas viajan por request. Coincide con el batch de upsert del brief. */
export const BATCH_SIZE = 500;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/**
 * Una fila ya mapeada, lista para escribir.
 *
 * El navegador ya validó antes de mandar, pero esto se vuelve a correr en el
 * servidor: la validación del cliente es para dar buenos mensajes, no para confiar.
 * Un POST armado a mano no pasa por la pantalla de mapeo.
 */
export const mappedRowSchema = z.object({
  externalId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  documentNumber: optionalText(60),
  email: optionalText(160),
  phone: optionalText(40),
  phoneAlt: optionalText(40),
  invoiceNumber: z.string().trim().min(1).max(120),
  // Corto a propósito: es una categoría para agrupar, no una descripción.
  product: optionalText(120),
  // Los montos ya llegan normalizados a número por parse-values.
  amount: z.number().finite().min(0).max(1e15),
  // ISO estricto: cualquier ambigüedad de formato se resolvió en el cliente.
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida"),
  description: optionalText(500),
});

export const importBatchSchema = z.object({
  portfolioId: idSchema,
  rows: z.array(mappedRowSchema).min(1).max(BATCH_SIZE),
});

export type MappedRow = z.infer<typeof mappedRowSchema>;

/** Error de una fila concreta, para mostrar y para descargar. */
export type RowError = {
  row: number;
  field: string;
  message: string;
};
