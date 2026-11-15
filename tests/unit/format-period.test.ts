import { describe, expect, it } from "vitest";

import { currentMonth, parsePeriod } from "@/lib/collections/period";
import {
  ESTADOS_ABIERTOS,
  INVOICE_STATUS_LABELS,
  MANUAL_INVOICE_STATUSES,
  esCarteraActiva,
} from "@/lib/collections/invoice-status";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatPercent, safePercent } from "@/lib/format";

describe("formatDate — una fecha de calendario no se corre de día", () => {
  it('"2026-10-01" se muestra como 1 de octubre, no como 30 de septiembre', () => {
    // Bug real: new Date("2026-10-01") es medianoche UTC, y date-fns imprime en
    // hora local. En Paraguay (UTC-3) el reporte mostraba el día anterior.
    expect(formatDate("2026-10-01")).toContain("1 oct");
    expect(formatDate("2026-01-01")).toContain("1 ene");
    expect(formatDate("2026-12-31")).toContain("31 dic");
  });

  it("sigue funcionando con un Date de verdad", () => {
    expect(formatDate(new Date(2026, 7, 14))).toContain("14 ago");
  });

  it("sin fecha devuelve una raya, no 'Invalid Date'", () => {
    expect(formatDate(null)).toBe("—");
  });
});

describe("formatCurrency", () => {
  it("el guaraní no lleva centavos", () => {
    const texto = formatCurrency(4812350, "PYG");
    expect(texto).toContain("Gs.");
    expect(texto).not.toContain(",00");
  });

  it("el dólar sí lleva centavos", () => {
    expect(formatCurrency(1234.5, "USD")).toContain("US$");
    expect(formatCurrency(1234.5, "USD")).toContain(",50");
  });
});

describe("safePercent — la base vacía da cero, no NaN", () => {
  it("dividir por cero devuelve 0", () => {
    expect(safePercent(10, 0)).toBe(0);
    expect(Number.isNaN(safePercent(0, 0))).toBe(false);
  });

  it("calcula el porcentaje normal", () => {
    expect(safePercent(25, 200)).toBe(12.5);
    expect(formatPercent(12.5)).toContain("12,5");
  });
});

describe("parsePeriod — un rango roto no puede mostrar todo en cero", () => {
  it("un rango al revés se ordena en vez de devolver vacío", () => {
    expect(parsePeriod({ from: "2026-11-30", to: "2026-11-01" })).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
  });

  it("un rango válido pasa tal cual", () => {
    expect(parsePeriod({ from: "2026-10-01", to: "2026-10-31" })).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("una fecha inválida cae al mes corriente", () => {
    const mes = currentMonth();
    expect(parsePeriod({ from: "no es fecha", to: "tampoco" })).toEqual(mes);
    expect(parsePeriod({})).toEqual(mes);
    // Nada de formatos raros: solo YYYY-MM-DD.
    expect(parsePeriod({ from: "01/10/2026", to: "31/10/2026" })).toEqual(mes);
  });

  it("el mes corriente empieza el día 1 y no termina después de hoy", () => {
    const { from, to } = currentMonth();
    expect(from.endsWith("-01")).toBe(true);
    expect(from <= to).toBe(true);
    expect(from.slice(0, 7)).toBe(to.slice(0, 7));
  });
});

describe("estados de comprobante", () => {
  const TODOS: InvoiceStatus[] = [
    "PENDING",
    "PARTIAL",
    "PAID",
    "CANCELLED",
    "REFINANCED",
    "WRITTEN_OFF",
  ];

  it("todos los estados tienen etiqueta", () => {
    for (const estado of TODOS) {
      expect(INVOICE_STATUS_LABELS[estado]).toBeTruthy();
    }
  });

  it("solo pendiente y parcial son cartera cobrable", () => {
    // Si castigado o refinanciado entran acá, el saldo del deudor y el dashboard
    // empiezan a contar deuda que contablemente ya no existe.
    expect(esCarteraActiva("PENDING")).toBe(true);
    expect(esCarteraActiva("PARTIAL")).toBe(true);
    for (const estado of ["PAID", "CANCELLED", "REFINANCED", "WRITTEN_OFF"] as const) {
      expect(esCarteraActiva(estado)).toBe(false);
    }
    expect([...ESTADOS_ABIERTOS].sort()).toEqual(["PARTIAL", "PENDING"]);
  });

  it("a mano no se puede marcar como pagado", () => {
    // PAID y PARTIAL los calcula el sistema desde los cobros. Ofrecerlos en el
    // selector permitiría dar una deuda por cobrada sin que entre un guaraní.
    const manuales = MANUAL_INVOICE_STATUSES.map((e) => e.value);
    expect(manuales).not.toContain("PAID");
    expect(manuales).not.toContain("PARTIAL");
    for (const opcion of MANUAL_INVOICE_STATUSES) {
      expect(opcion.hint).toBeTruthy();
    }
  });
});
