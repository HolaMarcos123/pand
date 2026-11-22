import { clasificarColumna } from "@/lib/import/parse-values";
import type { MappedRow } from "@/lib/import/row-schema";

/**
 * Dos filas de la planilla que dicen ser la misma cuota del mismo credito.
 *
 * Esto lo rechaza el servidor desde que una cartera real entro mal, pero lo
 * rechazaba tarde: despues de apretar "Procesar", con la cartera ya creada y
 * con un mensaje que adivinaba la causa en vez de saberla. El navegador tiene
 * las filas desde el paso de mapeo, asi que puede decirlo antes y con nombre y
 * apellido. El chequeo del servidor queda igual: es la ultima linea.
 */

/**
 * La identidad de una deuda: deudor + operacion + cuota.
 *
 * Tiene que coincidir con la llave de `invoices`
 * (`organizationId, clientId, loanNumber, invoiceNumber`), porque es la que
 * decide si dos filas se pisan al escribir.
 */
export function claveDeDeuda(row: MappedRow): string {
  return `${row.externalId}\u0000${row.loanNumber ?? ""}\u0000${row.invoiceNumber}`;
}

/**
 * Dos filas describen la misma deuda, y no dos deudas distintas que comparten
 * numero de comprobante.
 *
 * Se comparan los campos que identifican la deuda y no los de contacto: una
 * planilla puede traer la fila del deudor repetida con el telefono corregido, y
 * eso no la convierte en otra deuda.
 */
export function mismaDeuda(a: MappedRow, b: MappedRow): boolean {
  return (
    a.externalId === b.externalId &&
    a.amount === b.amount &&
    a.dueDate === b.dueDate &&
    // La moneda entra en la comparacion: 500 dolares y 500 guaranies son la
    // misma cifra y deudas que no se parecen en nada.
    a.currency === b.currency
  );
}

export type CuotaRepetida = {
  externalId: string;
  loanNumber: string | null;
  invoiceNumber: string;
  /** Numeros de fila como los ve la persona en Excel. */
  filas: [number, number];
  /** Cuantas colisiones hay en toda la planilla, no solo esta. */
  total: number;
};

/**
 * La primera cuota repetida con deudas distintas, y cuantas hay en total.
 *
 * Devuelve `null` cuando la planilla esta bien: repetir la MISMA fila no es un
 * problema —se deduplica— y es comun en planillas exportadas de un ERP.
 */
export function detectarCuotaRepetida(rows: MappedRow[]): CuotaRepetida | null {
  const vistas = new Map<string, { row: MappedRow; fila: number }>();
  let primera: Omit<CuotaRepetida, "total"> | undefined;
  let total = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const clave = claveDeDeuda(row);
    const previa = vistas.get(clave);

    if (previa && !mismaDeuda(previa.row, row)) {
      total += 1;
      primera ??= {
        externalId: row.externalId,
        loanNumber: row.loanNumber ?? null,
        invoiceNumber: row.invoiceNumber,
        // +2: la fila 1 son los encabezados y los humanos cuentan desde 1.
        filas: [previa.fila + 2, index + 2],
      };
      continue;
    }

    vistas.set(clave, { row, fila: index });
  }

  return primera ? { ...primera, total } : null;
}

/**
 * Que columna del archivo serviria como "Nro. de cuota" sin repetir deudas.
 *
 * El caso que motiva esto: un cuotero trae "NR_FACTURA" con
 * "15701-2-3000332" —que es el numero del credito, igual en las 35 cuotas— y
 * "NR_CUO" con "13/35", que es la cuota de verdad. Mapear la primera hace que
 * las 35 filas del credito digan ser la misma deuda.
 *
 * Se prueba cada columna como si fuera la cuota y se busca una que deje todas
 * las deudas distintas. Entre las que sirven gana la que tiene forma "13/35":
 * es la senal mas fuerte de que una columna es un numero de cuota.
 */
export function sugerirColumnaDeCuota(
  filas: Record<string, unknown>[],
  headers: string[],
  columnas: { externalId?: string; loanNumber?: string; invoiceNumber?: string },
): string | null {
  if (!columnas.externalId) return null;

  const texto = (valor: unknown) =>
    valor === null || valor === undefined ? "" : String(valor).trim();

  const candidatas = headers.filter(
    (h) =>
      h !== columnas.invoiceNumber &&
      h !== columnas.externalId &&
      h !== columnas.loanNumber,
  );

  const sirven = candidatas.filter((header) => {
    const claves = new Set<string>();
    for (const fila of filas) {
      const valor = texto(fila[header]);
      // Una columna con huecos no puede identificar una cuota.
      if (!valor) return false;

      const clave = `${texto(fila[columnas.externalId!])}\u0000${
        columnas.loanNumber ? texto(fila[columnas.loanNumber]) : ""
      }\u0000${valor}`;

      if (claves.has(clave)) return false;
      claves.add(clave);
    }
    return true;
  });

  if (sirven.length === 0) return null;

  const muestra = filas.slice(0, 30);
  const fraccion = sirven.find(
    (header) =>
      clasificarColumna(muestra.map((fila) => fila[header])) === "fraccion",
  );

  return fraccion ?? sirven[0];
}
