export type SheetData = {
  headers: string[];
  rows: Record<string, unknown>[];
};

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROWS = 50_000;

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
      `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es 15 MB.`,
    );
  }

  const name = file.name.toLowerCase();

  if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
    return readCsv(file);
  }

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm") || name.endsWith(".xls")) {
    return readExcel(file);
  }

  throw new Error("Formato no soportado. Subí un .xlsx o un .csv.");
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
      preview: MAX_ROWS,
      complete(result) {
        const headers = (result.meta.fields ?? []).filter(Boolean);
        if (!headers.length) {
          reject(new Error("El archivo no tiene fila de encabezados."));
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

  const rows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      blankrows: false,
      raw: true,
    })
    .slice(0, MAX_ROWS);

  return { headers, rows };
}
