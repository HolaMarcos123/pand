import {
  parseAmount,
  parseCurrency,
  parseDate,
  parseText,
} from "@/lib/import/parse-values";
import type { MappedRow, RowError } from "@/lib/import/row-schema";
import {
  esCampoPropio,
  idDelCampoPropio,
  type FieldDef,
  type MappableKey,
} from "@/lib/import/sector-config";

/**
 * Un campo propio cuyo valor no entró en el tipo declarado. No descarta nada:
 * se cuenta y se avisa, agrupado por campo, porque reportarlo fila por fila en
 * una cartera de 5.000 llena la pantalla con la misma línea repetida.
 */
export type Aviso = {
  field: string;
  count: number;
  ejemplo: string;
};

export type ValidationOutcome = {
  valid: MappedRow[];
  /**
   * El numero de fila de Excel de cada entrada de `valid`, en el mismo orden.
   *
   * Va aparte porque `MappedRow` es lo que viaja al servidor y no tiene por que
   * cargar con esto. Hace falta para poder decir "filas 4982 y 4992" despues de
   * que la validacion descarto filas del medio: sin esto se contaba sobre
   * `valid` y el numero no era el que la persona ve en la planilla.
   */
  numeros: number[];
  errors: RowError[];
  avisos: Aviso[];
};

/**
 * Convierte las filas crudas del archivo en filas listas para escribir, usando el
 * mapeo que armó el usuario.
 *
 * Una fila con cualquier error se descarta entera y se reporta. No se importa "a
 * medias": una factura sin vencimiento o sin monto no es una deuda que se pueda
 * gestionar, y dejarla entrar con ceros ensucia todos los KPIs.
 *
 * Los campos propios son la excepción, y es a propósito. Son datos que la
 * organización quiere conservar pero con los que Pand no hace cuentas: terminan
 * en el `metadata` del comprobante. Si un campo declarado "numero" recibe
 * "0985-925618", el tipo está mal elegido —no la deuda—, así que se guarda el
 * texto crudo y la fila entra igual. Descartarla costaba la cuota entera por un
 * dato accesorio.
 */
export function validateRows(
  rows: Record<string, unknown>[],
  mapping: Partial<Record<MappableKey, string>>,
  fields: FieldDef[],
): ValidationOutcome {
  const valid: MappedRow[] = [];
  const numeros: number[] = [];
  const errors: RowError[] = [];
  const avisos = new Map<string, Aviso>();

  const avisar = (field: string, valor: unknown) => {
    const existente = avisos.get(field);
    if (existente) {
      existente.count += 1;
      return;
    }
    avisos.set(field, { field, count: 1, ejemplo: String(valor).trim().slice(0, 40) });
  };

  rows.forEach((raw, index) => {
    // +2: la fila 1 son los encabezados y los humanos cuentan desde 1, así que este
    // número coincide con lo que el usuario ve en Excel.
    const rowNumber = index + 2;
    const built: Record<string, unknown> = {};
    // Los campos propios de la organizacion no son columnas de la tabla: van
    // juntos en un objeto que termina en el `metadata` del comprobante.
    const propios: Record<string, string | number | null> = {};
    let failed = false;

    for (const field of fields) {
      const column = mapping[field.key];
      const value = column ? raw[column] : undefined;

      const propio = esCampoPropio(field.key);

      /** Donde se guarda el valor ya convertido de este campo. */
      const guardar = (v: unknown) => {
        if (propio) {
          propios[idDelCampoPropio(field.key)] = v as string | number | null;
        } else {
          built[field.key] = v;
        }
      };

      /**
       * Un valor que no entró en el tipo. En un campo de Pand descarta la fila;
       * en uno propio se conserva como texto y solo se avisa.
       */
      const noEntro = (reason: string) => {
        if (propio) {
          guardar(String(value).trim());
          avisar(field.label, value);
          return;
        }
        errors.push({ row: rowNumber, field: field.label, message: reason });
        failed = true;
      };

      if (field.type === "number") {
        const result = parseAmount(value);
        if (result.ok) {
          guardar(result.value);
        } else if (result.empty) {
          if (field.required) {
            errors.push({ row: rowNumber, field: field.label, message: "vacío" });
            failed = true;
          } else {
            guardar(null);
          }
        } else {
          noEntro(result.reason);
        }
        continue;
      }

      if (field.type === "date") {
        const result = parseDate(value);
        if (result.ok) {
          guardar(result.value.toISOString().slice(0, 10));
        } else if (result.empty) {
          if (field.required) {
            errors.push({ row: rowNumber, field: field.label, message: "vacío" });
            failed = true;
          } else {
            guardar(null);
          }
        } else {
          noEntro(result.reason);
        }
        continue;
      }

      if (field.type === "currency") {
        const result = parseCurrency(value);
        if (result.ok) {
          guardar(result.value);
        } else if (result.empty) {
          // Sin moneda en la fila, la pone el servidor con la de la
          // organización. No se adivina acá.
          guardar(null);
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
        guardar(result.value);
      } else if (field.required) {
        errors.push({ row: rowNumber, field: field.label, message: "vacío" });
        failed = true;
      } else {
        guardar(null);
      }
    }

    if (Object.keys(propios).length > 0) built.custom = propios;

    if (!failed) {
      valid.push(built as MappedRow);
      numeros.push(rowNumber);
    }
  });

  return { valid, numeros, errors, avisos: [...avisos.values()] };
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
