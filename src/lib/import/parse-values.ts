/**
 * Conversión de los valores crudos de una planilla a tipos de Pand.
 *
 * Acá es donde se corrompe la plata si uno se descuida: "1.234.567" son un millón
 * doscientos mil guaraníes, no uno con doscientos treinta y cuatro mil. Cada regla
 * de abajo está escrita para ese caso.
 */

/** Resultado explícito: distinguir "vacío" de "inválido" cambia el mensaje de error. */
export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; empty: true }
  | { ok: false; empty: false; reason: string };

const EMPTY = { ok: false as const, empty: true as const };

export function parseText(raw: unknown): ParseResult<string> {
  if (raw === null || raw === undefined) return EMPTY;
  const value = String(raw).trim();
  if (!value) return EMPTY;
  return { ok: true, value };
}

/**
 * Monto. Acepta lo que sale de Excel y lo que escribe un humano:
 * 1234567 · "1.234.567" · "1,234,567.89" · "1.234.567,89" · "Gs. 1.234.567" · "(500)"
 *
 * La regla que resuelve la ambigüedad entre punto y coma: **el último separador que
 * aparece es el decimal**, salvo que lo que le sigue tenga exactamente 3 dígitos y
 * haya más de un separador del mismo tipo, en cuyo caso es de miles. Un separador
 * suelto seguido de 3 dígitos se trata como miles, que es el caso paraguayo y el que
 * más rompe.
 */
export function parseAmount(raw: unknown): ParseResult<number> {
  if (raw === null || raw === undefined || raw === "") return EMPTY;

  // Excel ya lo entrega numérico: no hay nada que interpretar.
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, empty: false, reason: "no es un número" };
    return { ok: true, value: raw };
  }

  let text = String(raw).trim();
  if (!text) return EMPTY;

  // Negativos entre paréntesis, como los exporta buena parte de los ERP.
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  // Fuera símbolos de moneda, espacios y espacios duros.
  text = text.replace(/[^\d.,-]/g, "");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  }
  if (!text) return EMPTY;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalSep = "";

  if (lastDot !== -1 && lastComma !== -1) {
    // Están los dos: el que va más a la derecha es el decimal.
    decimalSep = lastDot > lastComma ? "." : ",";
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? "." : ",";
    const parts = text.split(sep);
    const tail = parts[parts.length - 1];
    // Un solo separador con 3 dígitos detrás es de miles ("1.234" = mil doscientos
    // treinta y cuatro). Con 1, 2 o más de 3 dígitos, es decimal.
    const looksThousands = parts.length > 2 || tail.length === 3;
    decimalSep = looksThousands ? "" : sep;
  }

  const normalized = decimalSep
    ? text
        .split(decimalSep)
        .map((part, index, all) =>
          index === all.length - 1 ? part : part.replace(/[.,]/g, ""),
        )
        .join(".")
    : text.replace(/[.,]/g, "");

  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    return { ok: false, empty: false, reason: `no se pudo leer "${raw}" como monto` };
  }

  return { ok: true, value: negative ? -value : value };
}

/**
 * Fecha. Excel con `cellDates` ya entrega Date; lo demás llega como texto.
 *
 * Se prueba dd/mm/yyyy ANTES que mm/dd/yyyy porque el usuario es de la región y
 * "03/04/2026" es 3 de abril. Invertir ese orden desplaza vencimientos un mes sin
 * que nadie lo note.
 */
export function parseDate(raw: unknown): ParseResult<Date> {
  if (raw === null || raw === undefined || raw === "") return EMPTY;

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      return { ok: false, empty: false, reason: "fecha inválida" };
    }
    return { ok: true, value: raw };
  }

  // Serial de Excel: días desde 1899-12-30.
  if (typeof raw === "number") {
    if (raw < 1 || raw > 200000) {
      return { ok: false, empty: false, reason: `"${raw}" no parece una fecha` };
    }
    const epoch = Date.UTC(1899, 11, 30);
    return { ok: true, value: new Date(epoch + Math.round(raw) * 86400000) };
  }

  const text = String(raw).trim();
  if (!text) return EMPTY;

  // ISO primero: es inequívoco.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), text);
  }

  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (parts) {
    const day = Number(parts[1]);
    const month = Number(parts[2]);
    let year = Number(parts[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    return buildDate(year, month, day, text);
  }

  return { ok: false, empty: false, reason: `no se pudo leer "${text}" como fecha` };
}

function buildDate(
  year: number,
  month: number,
  day: number,
  original: string,
): ParseResult<Date> {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, empty: false, reason: `"${original}" no es una fecha válida` };
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  // Atrapa 31/02: JavaScript lo desborda a marzo en vez de fallar.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, empty: false, reason: `"${original}" no existe en el calendario` };
  }

  return { ok: true, value: date };
}

/**
 * Moneda. Acepta el código, el símbolo y el nombre, como lo escribe cualquiera.
 *
 * "USD" · "US$" · "u$s" · "dólar" · "dolares" · "$"
 * "PYG" · "Gs." · "G$" · "₲" · "guaraníes" · "gs"
 *
 * El "$" suelto se lee como dólar y no como peso: en Paraguay, que es para quién
 * está escrito esto, el guaraní se escribe "Gs." y el "$" se usa para el dólar.
 * Un peso argentino se escribe "ARS" o "$ARS" en una planilla que los distinga.
 *
 * Devolver la moneda inválida como error y no caer a la de la organización es a
 * propósito: una columna de moneda que no se entiende significa que el mapeo está
 * mal o que el dato viene sucio, y adivinar "guaraníes" convertiría una deuda en
 * dólares en una deuda 7.000 veces más chica, sin que nadie se entere.
 */
export function parseCurrency(raw: unknown): ParseResult<string> {
  if (raw === null || raw === undefined) return EMPTY;

  const texto = String(raw).trim();
  if (!texto) return EMPTY;

  const limpio = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s.]/g, "");

  if (/^(usd|us\$|u\$s|u\$|\$us|dolar(es)?|dol|\$)$/.test(limpio)) return { ok: true, value: "USD" };
  if (/^(pyg|gs|g\$|₲|guarani(es)?|gua|gy)$/.test(limpio)) return { ok: true, value: "PYG" };
  if (/^(ars|\$ars|peso(s)?(argentino(s)?)?)$/.test(limpio)) return { ok: true, value: "ARS" };
  if (/^(brl|r\$|real(es)?)$/.test(limpio)) return { ok: true, value: "BRL" };

  return {
    ok: false,
    empty: false,
    reason: `moneda no reconocida: "${texto}"`,
  };
}
