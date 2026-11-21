import {
  parseAmount,
  parseCurrency,
  parseDate,
  parseText,
} from "@/lib/import/parse-values";
import type { MappedRow, RowError } from "@/lib/import/row-schema";
import type { FieldDef, FieldKey } from "@/lib/import/sector-config";

export type ValidationOutcome = {
  valid: MappedRow[];
  errors: RowError[];
};

/**
 * Convierte las filas crudas del archivo en filas listas para escribir, usando el
 * mapeo que armó el usuario.
 *
 * Una fila con cualquier error se descarta entera y se reporta. No se importa "a
 * medias": una factura sin vencimiento o sin monto no es una deuda que se pueda
 * gestionar, y dejarla entrar con ceros ensucia todos los KPIs.
 */
export function validateRows(
  rows: Record<string, unknown>[],
  mapping: Partial<Record<FieldKey, string>>,
  fields: FieldDef[],
): ValidationOutcome {
  const valid: MappedRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((raw, index) => {
    // +2: la fila 1 son los encabezados y los humanos cuentan desde 1, así que este
    // número coincide con lo que el usuario ve en Excel.
    const rowNumber = index + 2;
    const built: Record<string, unknown> = {};
    let failed = false;

    for (const field of fields) {
      const column = mapping[field.key];
      const value = column ? raw[column] : undefined;

      if (field.type === "number") {
        const result = parseAmount(value);
        if (result.ok) {
          built[field.key] = result.value;
        } else if (result.empty) {
          if (field.required) {
            errors.push({ row: rowNumber, field: field.label, message: "vacío" });
            failed = true;
          } else {
            built[field.key] = null;
          }
        } else {
          errors.push({ row: rowNumber, field: field.label, message: result.reason });
          failed = true;
        }
        continue;
      }

      if (field.type === "date") {
        const result = parseDate(value);
        if (result.ok) {
          built[field.key] = result.value.toISOString().slice(0, 10);
        } else if (result.empty) {
          if (field.required) {
            errors.push({ row: rowNumber, field: field.label, message: "vacío" });
            failed = true;
          } else {
            built[field.key] = null;
          }
        } else {
          errors.push({ row: rowNumber, field: field.label, message: result.reason });
          failed = true;
        }
        continue;
      }

      if (field.type === "currency") {
        const result = parseCurrency(value);
        if (result.ok) {
          built[field.key] = result.value;
        } else if (result.empty) {
          // Sin moneda en la fila, la pone el servidor con la de la
          // organización. No se adivina acá.
          built[field.key] = null;
        } else {
          // Una moneda que no se entiende NO cae a la de la organización: eso
          // convertiría una deuda en dólares en una 7.000 veces más chica sin
          // que nadie se entere. La fila se reporta y se descarta.
          errors.push({ row: rowNumber, field: field.label, message: result.reason });
          failed = true;
        }
        continue;
      }

      const result = parseText(value);
      if (result.ok) {
        built[field.key] = result.value;
      } else if (field.required) {
        errors.push({ row: rowNumber, field: field.label, message: "vacío" });
        failed = true;
      } else {
        built[field.key] = null;
      }
    }

    if (!failed) valid.push(built as MappedRow);
  });

  return { valid, errors };
}

/** CSV de errores para descargar, con BOM para que Excel respete los acentos. */
export function errorsToCsv(errors: RowError[]): string {
  const lines = ["Fila,Campo,Problema"];
  for (const error of errors) {
    const field = `"${error.field.replace(/"/g, '""')}"`;
    const message = `"${error.message.replace(/"/g, '""')}"`;
    lines.push(`${error.row},${field},${message}`);
  }
  return `﻿${lines.join("\n")}`;
}
