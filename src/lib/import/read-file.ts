export type SheetData = {
  headers: string[];
  rows: Record<string, unknown>[];
};

/**
 * Tope de tamaño del archivo.
 *
 * El número sale de lo que aguanta la pestaña del navegador, no de una regla del
 * servidor: acá el archivo se parsea del lado del cliente (ver abajo). Un .xlsx
 * es un zip de XML y SheetJS lo expande en memoria, así que un archivo grande
 * pesa mucho más adentro que en el disco. Para carteras de verdad conviene
 * .xlsb o .csv, que son bastante más livianos de leer.
 */
export const MAX_FILE_BYTES = 70 * 1024 * 1024;

/**
 * Tope de filas.
 *
 * Es el límite que de verdad importa: pasada esta cantidad, el importador **no
 * recorta**, rechaza el archivo y dice cuántas filas tiene. Antes se quedaba con
 * las primeras y descartaba el resto sin avisar, que en una cartera de cobranzas
 * significa deudores que simplemente no existen para nadie —y nadie se entera
 * hasta que alguien reclama una deuda que el sistema no tiene—.
 *
 * El importador es incremental: parte un archivo grande en dos y las dos partes
 * entran bien.
 */
export const MAX_ROWS = 200_000;

const MB = 1024 * 1024;

function mb(bytes: number): string {
  const n = bytes / MB;
  // Sin decimal cuando es redondo: "pesa 70.0 MB y el máximo es 70.0 MB" se lee
  // como un error del sistema, no como un archivo pasado de tamaño.
  return `${Number.isInteger(n) ? n : n.toFixed(1)} MB`;
}

/** Formatos que el importador sabe leer, para el `accept` del input y el error. */
export const EXTENSIONES_SOPORTADAS = [
  ".xlsx",
  ".xlsm",
  ".xlsb",
  ".xls",
  ".csv",
  ".tsv",
] as const;

/**
 * Lee una planilla en el navegador de quien la sube.
 *
 * Que el parseo sea del lado del cliente no es una comodidad, es la decisión de
 * seguridad del módulo: el archivo del cliente —que es contenido no confiable— nunca
 * toca nuestro servidor. Al backend solo le llegan filas ya mapeadas y validadas
 * como JSON, que se vuelven a validar con zod.
 *
 * Aun así se usa el build oficial de SheetJS (cdn.sheetjs.com) y no el de npm, que
 * arrastra prototype pollution y ReDoS sin parche.
 */
export async function readSpreadsheet(file: File): Promise<SheetData> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `El archivo pesa ${mb(file.size)} y el máximo es ${mb(MAX_FILE_BYTES)}. ` +
        "Si es un .xlsx, guardalo como .xlsb o .csv: pesan bastante menos.",
    );
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    return readCsv(file);
  }

  // .xlsb es binario en vez de XML comprimido: para la misma cartera pesa menos
  // y se lee más rápido. Es el formato recomendado para archivos grandes.
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xlsm") ||
    name.endsWith(".xlsb") ||
    name.endsWith(".xls")
  ) {
    return readExcel(file);
  }

  throw new Error(
    `Formato no soportado. Se puede subir ${EXTENSIONES_SOPORTADAS.join(", ")}.`,
  );
}

/** Mismo mensaje para los dos lectores: el archivo entero o nada. */
function demasiadasFilas(filas: number): Error {
  return new Error(
    `El archivo tiene al menos ${filas.toLocaleString("es-PY")} filas y el máximo es ` +
      `${MAX_ROWS.toLocaleString("es-PY")}. Dividilo en partes y subilas una por una: ` +
      "el importador es incremental, así que no se duplica nada.",
  );
}

async function readCsv(file: File): Promise<SheetData> {
  // Import dinámico: papaparse solo se descarga si hay un CSV que leer.
  const Papa = (await import("papaparse")).default;

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      // Sin conversión automática: los números y fechas los interpreta parse-values,
      // que sabe de separadores latinoamericanos. Papaparse leería "1.234" como 1,234.
      dynamicTyping: false,
      // Una fila más que el tope: si llega esa fila de más, el archivo se pasa.
      // Leer solo MAX_ROWS no permitiría distinguir "justo el tope" de "más".
      preview: MAX_ROWS + 1,
      complete(result) {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (!headers.length) {
          reject(new Error("El archivo no tiene fila de encabezados."));
          return;
        }
        if (result.data.length > MAX_ROWS) {
          reject(demasiadasFilas(result.data.length));
          return;
        }
        resolve({ headers, rows: result.data });
      },
      error(error) {
        reject(new Error(`No se pudo leer el CSV: ${error.message}`));
      },
    });
  });
}

async function readExcel(file: File): Promise<SheetData> {
  // SheetJS pesa cerca de un megabyte: se descarga solo cuando hace falta.
  const XLSX = await import("xlsx");

  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    // Devuelve Date en vez del serial numérico de Excel.
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("El archivo no tiene ninguna hoja.");

  const sheet = workbook.Sheets[sheetName];

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
  });

  if (!matrix.length) throw new Error("La hoja está vacía.");

  const headers = (matrix[0] as unknown[])
    .map((cell) => (cell === null || cell === undefined ? "" : String(cell).trim()))
    .filter(Boolean);

  if (!headers.length) throw new Error("El archivo no tiene fila de encabezados.");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    blankrows: false,
    raw: true,
  });

  if (rows.length > MAX_ROWS) throw demasiadasFilas(rows.length);

  return { headers, rows };
}
