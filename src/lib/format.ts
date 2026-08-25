import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

/**
 * Símbolos por moneda. El manual de marca escribe los guaraníes como "Gs. 4.812.350",
 * no con el símbolo ₲ que devolvería Intl con style:"currency".
 */
const SYMBOLS: Record<string, string> = {
  PYG: "Gs.",
  USD: "US$",
  ARS: "$",
  BRL: "R$",
};

// El guaraní no tiene fracción: mostrar centavos sería incorrecto, no solo feo.
const DECIMALS: Record<string, number> = {
  PYG: 0,
  USD: 2,
  ARS: 2,
  BRL: 2,
};

/** "Gs. 4.812.350" · "US$ 1.234,56" */
export function formatCurrency(amount: number, currency = "PYG"): string {
  const decimals = DECIMALS[currency] ?? 2;
  const symbol = SYMBOLS[currency] ?? currency;

  const value = new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);

  return `${symbol} ${value}`;
}

/** "68,4 %" — con espacio antes del signo, como en el manual. */
export function formatPercent(value: number, decimals = 1): string {
  return `${new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)} %`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-PY").format(value);
}

/** "14 ago 2026" */
export function formatDate(date: Date | string | null): string {
  if (!date) return "—";
  return format(new Date(date), "d MMM yyyy", { locale: es });
}

/** "hace 3 días" */
export function formatRelative(date: Date | string | null): string {
  if (!date) return "Nunca";
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: es });
}

/**
 * Porcentaje que representa `part` sobre `total`, protegido contra división por
 * cero: con la base vacía la respuesta correcta es 0, no NaN ni Infinity.
 */
export function safePercent(part: number, total: number): number {
  if (!total) return 0;
  return (part / total) * 100;
}
