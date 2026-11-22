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

/** Las columnas del archivo que arman la identidad de una deuda. */
export type ColumnasDeIdentidad = {
  externalId?: string;
  loanNumber?: string;
  invoiceNumber?: string;
  amount?: string;
  dueDate?: string;
  currency?: string;
};

export type SugerenciaDeCuota = {
  columna: string;
  /** Choques que quedarian usando esta columna. 0 es resolverlo del todo. */
  restantes: number;
  /** Filas sin valor ahi. El numero de cuota es obligatorio, asi que molestan. */
  vacias: number;
};

const texto = (valor: unknown) =>
  valor === null || valor === undefined ? "" : String(valor).trim();

/**
 * Cuantas deudas quedarian repetidas si esta columna fuera el "Nro. de cuota".
 *
 * Dos filas con la misma clave no son un choque si describen la misma deuda:
 * una planilla exportada de un ERP repite filas, y eso se deduplica. Se compara
 * monto, vencimiento y moneda en crudo, que es lo mismo que mira `mismaDeuda`
 * una vez convertidos.
 */
function choquesCon(
  filas: Record<string, unknown>[],
  header: string,
  columnas: ColumnasDeIdentidad,
): { restantes: number; vacias: number } {
  const vistas = new Map<string, string>();
  let restantes = 0;
  let vacias = 0;

  for (const fila of filas) {
    const valor = texto(fila[header]);
    if (!valor) {
      vacias += 1;
      continue;
    }

    const clave = `${texto(fila[columnas.externalId!])}\u0000${
      columnas.loanNumber ? texto(fila[columnas.loanNumber]) : ""
    }\u0000${valor}`;

    const deuda = [
      columnas.amount ? texto(fila[columnas.amount]) : "",
      columnas.dueDate ? texto(fila[columnas.dueDate]) : "",
      columnas.currency ? texto(fila[columnas.currency]) : "",
    ].join("\u0000");

    const previa = vistas.get(clave);
    if (previa !== undefined && previa !== deuda) {
      restantes += 1;
      continue;
    }
    vistas.set(clave, deuda);
  }

  return { restantes, vacias };
}

/**
 * Que columna del archivo serviria mejor como "Nro. de cuota".
 *
 * El caso que motiva esto: un cuotero trae "NR_FACTURA" con
 * "15701-2-3000332" —el numero del credito, igual en sus 35 cuotas— y "NR_CUO"
 * con "13/35", que es la cuota de verdad. Mapeada la primera, las 35 filas
 * dicen ser la misma deuda.
 *
 * Ranquea en vez de exigir perfeccion, y eso es el punto. La version anterior
 * descartaba una columna al primer hueco o al primer repetido, asi que en un
 * archivo real de 44 columnas y 5.000 filas —donde siempre hay una fila sucia—
 * no encontraba nada y la pantalla decia "ninguna columna sirve" teniendo la
 * correcta al lado. Ahora gana la que deja menos choques; entre iguales, la que
 * tiene forma "13/35", que es la senal mas fuerte de un numero de cuota.
 *
 * Devuelve `null` solo si ninguna candidata mejora lo que ya hay.
 */
export function sugerirColumnaDeCuota(
  filas: Record<string, unknown>[],
  headers: string[],
  columnas: ColumnasDeIdentidad,
): SugerenciaDeCuota | null {
  if (!columnas.externalId) return null;

  // Las columnas que ya arman la deuda quedan afuera. El monto sobre todo:
  // sus valores suelen ser casi unicos, asi que ganaria el ranking y la
  // sugerencia seria exactamente el error que esto existe para evitar —la
  // cuota apuntando a una columna de plata.
  const enUso = new Set(
    [
      columnas.invoiceNumber,
      columnas.externalId,
      columnas.loanNumber,
      columnas.amount,
      columnas.dueDate,
      columnas.currency,
    ].filter(Boolean) as string[],
  );

  const candidatas = headers.filter((h) => !enUso.has(h));
  if (candidatas.length === 0) return null;

  const actual = columnas.invoiceNumber
    ? choquesCon(filas, columnas.invoiceNumber, columnas).restantes
    : Number.POSITIVE_INFINITY;

  const muestra = filas.slice(0, 30);
  const puntuadas = candidatas
    .map((columna, orden) => {
      const clase = clasificarColumna(muestra.map((fila) => fila[columna]));
      return {
        columna,
        orden,
        clase,
        esFraccion: clase === "fraccion",
        ...choquesCon(filas, columna, columnas),
      };
    })
    // Una columna vacia en todas las filas no identifica nada. Y una con forma
    // de plata nunca es un numero de cuota, por mas que sus valores no repitan:
    // es la misma regla que aplica el adivinador a los identificadores.
    .filter(
      (c) =>
        c.vacias < filas.length &&
        c.clase !== "monto" &&
        c.clase !== "montocero",
    );

  if (puntuadas.length === 0) return null;

  puntuadas.sort(
    (a, b) =>
      a.restantes - b.restantes ||
      a.vacias - b.vacias ||
      Number(b.esFraccion) - Number(a.esFraccion) ||
      a.orden - b.orden,
  );

  const mejor = puntuadas[0];
  if (mejor.restantes >= actual) return null;

  return { columna: mejor.columna, restantes: mejor.restantes, vacias: mejor.vacias };
}
