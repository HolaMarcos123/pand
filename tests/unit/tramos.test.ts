import { describe, expect, it } from "vitest";

import {
  TRAMOS,
  TRAMOS_ACTIVOS,
  TRAMO_LABELS,
  tramoCliente,
  tramoDe,
  type Tramo,
} from "@/lib/collections/tramos";

/**
 * El catálogo de tramos es la respuesta al bug #2 del QA de CobrAI: allá cada
 * pantalla corta la mora distinto y los totales no se pueden comparar entre sí.
 *
 * Estos tests existen para que eso no nos pase. Fijan los bordes exactos y la
 * propiedad que importa de verdad: cada deuda cae en un tramo y solo uno.
 */

describe("tramoDe — bordes exactos", () => {
  // Los bordes son donde se equivoca todo el mundo: el 30 es "1-30" y el 31 ya es
  // "31-60". Si alguien cambia un <= por un <, esto lo caza.
  const casos: [dias: number, esperado: Tramo][] = [
    [0, "AL_DIA"],
    [1, "T1_30"],
    [30, "T1_30"],
    [31, "T31_60"],
    [60, "T31_60"],
    [61, "T61_90"],
    [90, "T61_90"],
    [91, "PRE_LEGAL"],
    [180, "PRE_LEGAL"],
    [181, "LEGAL"],
    [5000, "LEGAL"],
  ];

  it.each(casos)("%i días cae en %s", (dias, esperado) => {
    expect(tramoDe(dias, "PENDING")).toBe(esperado);
  });

  it("una mora negativa (vence en el futuro) es Al día", () => {
    expect(tramoDe(-10, "PENDING")).toBe("AL_DIA");
  });
});

describe("tramoDe — el castigo gana sobre la antigüedad", () => {
  it("una deuda castigada de 400 días es Castigo, no Legal", () => {
    expect(tramoDe(400, "WRITTEN_OFF")).toBe("CASTIGO");
  });

  it("una deuda castigada sin mora también es Castigo", () => {
    expect(tramoDe(0, "WRITTEN_OFF")).toBe("CASTIGO");
  });

  it("refinanciada se clasifica por días: no es castigo", () => {
    expect(tramoDe(200, "REFINANCED")).toBe("LEGAL");
  });
});

describe("tramoCliente — se gestiona por la peor deuda abierta", () => {
  it("con deudas abiertas usa la más vieja", () => {
    expect(tramoCliente(95, 3, 0)).toBe("PRE_LEGAL");
  });

  it("sin deudas abiertas pero con castigadas, es Castigo y no Al día", () => {
    // Este es el caso que la versión anterior resolvía al revés: un deudor al que
    // le castigaron todo aparecía como si estuviera al día.
    expect(tramoCliente(null, 0, 2)).toBe("CASTIGO");
  });

  it("sin deudas abiertas ni castigadas, está Al día", () => {
    expect(tramoCliente(null, 0, 0)).toBe("AL_DIA");
  });

  it("con abiertas y castigadas a la vez, manda lo abierto", () => {
    // Todavía hay algo que cobrar: el deudor sigue en gestión activa.
    expect(tramoCliente(45, 1, 1)).toBe("T31_60");
  });
});

describe("el catálogo no se puede desarmar sin que esto falle", () => {
  it("todo tramo tiene etiqueta, incluido Castigo", () => {
    const todos: Tramo[] = [...TRAMOS.map((t) => t.key), "CASTIGO"];
    for (const tramo of todos) {
      expect(TRAMO_LABELS[tramo]).toBeTruthy();
    }
  });

  it("los límites van en orden creciente y el último es abierto", () => {
    const limites = TRAMOS.map((t) => t.hasta);
    expect(limites[limites.length - 1]).toBeNull();

    const finitos = limites.slice(0, -1) as number[];
    for (let i = 1; i < finitos.length; i += 1) {
      expect(finitos[i]).toBeGreaterThan(finitos[i - 1]);
    }
  });

  it("los tramos activos no incluyen Castigo", () => {
    // Castigo no es cartera activa. Si entra acá, el gráfico del dashboard empieza
    // a sumarlo al saldo y la cartera se infla — el bug #16 del QA de CobrAI.
    expect(TRAMOS_ACTIVOS).not.toContain("CASTIGO");
  });

  it("no hay claves ni etiquetas repetidas", () => {
    expect(new Set(TRAMOS.map((t) => t.key)).size).toBe(TRAMOS.length);
    expect(new Set(TRAMOS.map((t) => t.label)).size).toBe(TRAMOS.length);
  });

  it("cada cantidad de días cae en exactamente un tramo", () => {
    // La propiedad que importa: sin huecos ni solapamientos. Un hueco significa
    // deuda que no aparece en ninguna barra del gráfico.
    for (let dias = 0; dias <= 400; dias += 1) {
      const tramo = tramoDe(dias, "PENDING");
      expect(TRAMOS_ACTIVOS).toContain(tramo);
    }
  });
});
