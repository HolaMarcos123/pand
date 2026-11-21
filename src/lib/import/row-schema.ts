import { z } from "zod";

import { idSchema } from "@/lib/validation/id";

/**
 * Cuántas filas viajan por request.
 *
 * Eran 500 cuando el servidor hacía un upsert por fila y cada lote costaba
 * segundos. Ahora el lote se escribe en unas pocas sentencias masivas y el costo
 * por fila es de ~1 ms, así que lo que domina es el ida y vuelta HTTP: con 500
 * filas, 200.000 son 400 requests seguidos manejados por la pestaña.
 *
 * El techo lo pone el límite de body de los server actions (ver next.config.ts),
 * no la base. Una fila mapeada mide unos 370 bytes medidos sobre una cartera
 * realista, y hasta ~1,2 KB si trae descripción larga: 1.000 filas entran
 * cómodas en los 4 MB configurados, incluso en el peor caso.
 */
export const BATCH_SIZE = 1000;

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
  // Vacio cuando la planilla no la trae: la cartera tiene una sola operacion
  // por deudor y la cuota alcanza para identificar la deuda.
  loanNumber: optionalText(120),
  invoiceNumber: z.string().trim().min(1).max(120),
  // Corto a propósito: es una categoría para agrupar, no una descripción.
  product: optionalText(120),
  // Los montos ya llegan normalizados a número por parse-values.
  amount: z.number().finite().min(0).max(1e15),
  // ISO estricto: cualquier ambigüedad de formato se resolvió en el cliente.
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha inválida"),
  // Código ISO ya normalizado por parse-values. Nulo = la de la organización.
  currency: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/)
    .nullish()
    .transform((v) => (v ? v : null)),
  description: optionalText(500),
  referenceName: optionalText(120),
  referencePhone: optionalText(40),
  referenceRelation: optionalText(60),
  /**
   * Los campos propios de la organizacion, por id.
   *
   * Van en un objeto y no como columnas porque se definen en tiempo de
   * ejecucion: terminan en el `metadata` del comprobante. Se acota el tamano
   * para que una planilla rara no meta medio megabyte por fila.
   */
  custom: z
    .record(
      z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      z.union([z.string().max(500), z.number().finite(), z.null()]),
    )
    .refine((o) => Object.keys(o).length <= 20, "demasiados campos propios")
    .optional(),
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
