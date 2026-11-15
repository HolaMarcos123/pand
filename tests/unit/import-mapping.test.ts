import { describe, expect, it } from "vitest";

import type { PaymentMethod } from "@/generated/prisma/enums";
import {
  PAYMENT_METHODS,
  parsePaymentMethod,
  paymentMethodLabel,
  suggestPaymentMapping,
} from "@/lib/import/payment-config";
import { normalizeHeader } from "@/lib/import/normalize-header";
import { suggestMapping } from "@/lib/import/sector-config";

/**
 * El importador es por donde entra toda la cartera de un cliente nuevo. Un mapeo
 * mal adivinado no rompe nada: escribe datos equivocados en silencio, que es peor.
 *
 * Los dos primeros bloques fijan bugs que ya pasaron en planillas reales.
 */

describe("normalizeHeader — las palabras de unión no pueden romper el alias", () => {
  it('"Forma de Pago" se normaliza igual que "formapago"', () => {
    // Bug real: "Forma de Pago" daba "formadepago", no matcheaba el alias
    // "formapago", y TODOS los cobros importados entraban como método OTHER.
    expect(normalizeHeader("Forma de Pago")).toBe(normalizeHeader("formapago"));
  });

  it('"Fecha de Vencimiento" se normaliza igual que "fechavencimiento"', () => {
    // El mismo bug en el importador de cartera, con los vencimientos.
    expect(normalizeHeader("Fecha de Vencimiento")).toBe(
      normalizeHeader("fechavencimiento"),
    );
  });

  it("ignora acentos, mayúsculas, guiones y espacios", () => {
    const esperado = normalizeHeader("razonsocial");
    for (const variante of ["Razón Social", "RAZON_SOCIAL", "razón-social", " Razon  Social "]) {
      expect(normalizeHeader(variante)).toBe(esperado);
    }
  });
});

describe("suggestMapping — adivina las columnas de una planilla real", () => {
  it("mapea los encabezados típicos de una financiera", () => {
    const mapa = suggestMapping([
      "Nro. de Cliente",
      "Nombre",
      "CI",
      "Teléfono",
      "Nro. de Préstamo",
      "Producto",
      "Monto de la Cuota",
      "Fecha de Vencimiento",
    ]);

    expect(mapa.externalId).toBe("Nro. de Cliente");
    expect(mapa.documentNumber).toBe("CI");
    expect(mapa.phone).toBe("Teléfono");
    expect(mapa.product).toBe("Producto");
    expect(mapa.dueDate).toBe("Fecha de Vencimiento");
  });

  it("no inventa un mapeo para una columna que no reconoce", () => {
    const mapa = suggestMapping(["Columna rarísima", "Otra cosa"]);
    expect(Object.values(mapa).filter(Boolean)).toHaveLength(0);
  });
});

describe("parsePaymentMethod — los medios paraguayos van antes que los genéricos", () => {
  it('"Bancard" es BANCARD y no CARD', () => {
    // El orden importa: "bancard" contiene "card". Si la regla genérica de tarjeta
    // se evalúa primero, Bancard nunca se alcanza.
    expect(parsePaymentMethod("Bancard")).toBe("BANCARD");
    expect(parsePaymentMethod("BANCARD POS")).toBe("BANCARD");
  });

  const locales: [string, PaymentMethod][] = [
    ["Tigo Money", "TIGO_MONEY"],
    ["tigomoney", "TIGO_MONEY"],
    ["Personal Envíos", "PERSONAL_ENVIOS"],
    ["Pago Express", "PAGO_EXPRESS"],
    ["Aquí Pago", "AQUI_PAGO"],
  ];
  it.each(locales)("%s → %s", (texto, esperado) => {
    expect(parsePaymentMethod(texto)).toBe(esperado);
  });

  const genericos: [string, PaymentMethod][] = [
    ["Efectivo", "CASH"],
    ["Transferencia bancaria", "BANK_TRANSFER"],
    ["Tarjeta de crédito", "CARD"],
    ["Cheque", "CHECK"],
    ["Depósito", "DEPOSIT"],
  ];
  it.each(genericos)("%s → %s", (texto, esperado) => {
    expect(parsePaymentMethod(texto)).toBe(esperado);
  });

  it("lo que no se reconoce cae en OTHER, no revienta", () => {
    for (const valor of [null, undefined, "", "   ", "pago con criptomonedas"]) {
      expect(parsePaymentMethod(valor)).toBe("OTHER");
    }
  });
});

describe("catálogo de medios de pago", () => {
  it("cada medio del catálogo tiene etiqueta y no hay repetidos", () => {
    expect(new Set(PAYMENT_METHODS.map((m) => m.value)).size).toBe(
      PAYMENT_METHODS.length,
    );
    for (const metodo of PAYMENT_METHODS) {
      expect(paymentMethodLabel(metodo.value)).toBe(metodo.label);
    }
  });

  it("la etiqueta de cada medio vuelve a su propio valor", () => {
    // Esta es la propiedad que caza las colisiones entre reglas. Encontró que
    // "Depósito" caía en CARD, porque "deposito" contiene "pos" y la regla de
    // tarjeta se evaluaba primero. Un depósito bancario quedaba registrado como
    // pago con tarjeta, y el recupero por método mentía sin avisar.
    for (const metodo of PAYMENT_METHODS) {
      if (metodo.value === "OTHER") continue;
      expect(parsePaymentMethod(metodo.label)).toBe(metodo.value);
    }
  });

  it("todo lo que devuelve el parser se puede etiquetar", () => {
    // Si alguien agrega un medio al parser y se olvida del catálogo, la tabla de
    // recupero por método muestra "Otro" para algo que sí reconocimos.
    const delCatalogo = new Set(PAYMENT_METHODS.map((m) => m.value));
    for (const texto of ["bancard", "tigo money", "efectivo", "cheque", "aqui pago"]) {
      expect(delCatalogo.has(parsePaymentMethod(texto))).toBe(true);
    }
  });

  it("reconoce la columna del medio de pago en la planilla", () => {
    const mapa = suggestPaymentMapping(["Fecha", "Importe", "Forma de Pago", "Referencia"]);
    expect(mapa.method).toBe("Forma de Pago");
  });
});
