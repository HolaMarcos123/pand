import { describe, expect, it } from "vitest";

import {
  detectarCuotaRepetida,
  sugerirColumnaDeCuota,
} from "@/lib/import/duplicados";
import type { MappedRow } from "@/lib/import/row-schema";

/**
 * El caso real que motiva todo esto: un cuotero trae "NR_FACTURA" con
 * "15701-2-3000332" —que es el numero del credito, igual en las 35 cuotas— y
 * "NR_CUO" con "13/35", que es la cuota de verdad. Mapear la primera hace que
 * las 35 filas digan ser la misma deuda, y la carga se corta despues de crear
 * la cartera, con un mensaje que adivina la causa.
 */

function fila(extra: Partial<MappedRow> = {}): MappedRow {
  return {
    externalId: "CLI-PF-1956960",
    name: "Juan Perez",
    invoiceNumber: "13/35",
    amount: 375_000,
    dueDate: "2026-08-15",
    ...extra,
  } as MappedRow;
}

describe("detectarCuotaRepetida", () => {
  it("no reporta nada cuando cada cuota es distinta", () => {
    const filas = [
      fila({ invoiceNumber: "13/35", amount: 375_000 }),
      fila({ invoiceNumber: "14/35", amount: 380_000 }),
    ];

    expect(detectarCuotaRepetida(filas)).toBeNull();
  });

  it("tolera la fila repetida identica: se deduplica, no es un choque", () => {
    const filas = [fila(), fila()];

    expect(detectarCuotaRepetida(filas)).toBeNull();
  });

  it("detecta dos deudas distintas bajo el mismo numero de cuota", () => {
    const filas = [
      fila({ invoiceNumber: "15701-2-3000332", amount: 375_000 }),
      fila({ invoiceNumber: "15701-2-3000332", amount: 412_000 }),
    ];

    const r = detectarCuotaRepetida(filas);
    expect(r).toMatchObject({
      externalId: "CLI-PF-1956960",
      invoiceNumber: "15701-2-3000332",
      total: 1,
    });
  });

  it("reporta las filas como las numera Excel, con el encabezado contado", () => {
    const filas = [
      fila({ invoiceNumber: "A", amount: 1 }),
      fila({ invoiceNumber: "B", amount: 2 }),
      fila({ invoiceNumber: "A", amount: 999 }),
    ];

    expect(detectarCuotaRepetida(filas)?.filas).toEqual([2, 4]);
  });

  it("cuenta todas las colisiones pero reporta solo la primera", () => {
    const filas = [
      fila({ invoiceNumber: "A", amount: 1 }),
      fila({ invoiceNumber: "A", amount: 2 }),
      fila({ invoiceNumber: "B", amount: 3 }),
      fila({ invoiceNumber: "B", amount: 4 }),
    ];

    const r = detectarCuotaRepetida(filas);
    expect(r?.invoiceNumber).toBe("A");
    expect(r?.total).toBe(2);
  });

  it("la operacion separa dos creditos con la misma cuota", () => {
    const filas = [
      fila({ loanNumber: "3000332", invoiceNumber: "1/35", amount: 375_000 }),
      fila({ loanNumber: "3000999", invoiceNumber: "1/35", amount: 412_000 }),
    ];

    expect(detectarCuotaRepetida(filas)).toBeNull();
  });

  it("sin operacion mapeada, dos creditos del mismo deudor chocan", () => {
    // Es la otra causa del error, y por eso el mensaje menciona mapear
    // "Nro. de operacion".
    const filas = [
      fila({ invoiceNumber: "1/35", amount: 375_000 }),
      fila({ invoiceNumber: "1/35", amount: 412_000 }),
    ];

    expect(detectarCuotaRepetida(filas)?.total).toBe(1);
  });

  it("dos deudores pueden tener la misma cuota: no es un choque", () => {
    const filas = [
      fila({ externalId: "CLI-1", invoiceNumber: "1/60", amount: 100 }),
      fila({ externalId: "CLI-2", invoiceNumber: "1/60", amount: 200 }),
    ];

    expect(detectarCuotaRepetida(filas)).toBeNull();
  });

  it("la moneda distingue dos deudas con la misma cifra", () => {
    const filas = [
      fila({ invoiceNumber: "1/35", amount: 500, currency: "PYG" }),
      fila({ invoiceNumber: "1/35", amount: 500, currency: "USD" }),
    ];

    expect(detectarCuotaRepetida(filas)?.total).toBe(1);
  });
});

describe("sugerirColumnaDeCuota", () => {
  // El cuotero de la captura: NR_FACTURA repite por credito, NR_CUO no.
  const HEADERS = ["NRO_CLI", "SUCURSAL", "NR_FACTURA", "CONTRATO", "NR_CUO", "CUOTA"];
  const FILAS = [
    { NRO_CLI: "CLI-1", SUCURSAL: "Encarnacion", NR_FACTURA: "15701-2-3000332", CONTRATO: "3000332", NR_CUO: "13/35", CUOTA: "375,00" },
    { NRO_CLI: "CLI-1", SUCURSAL: "Encarnacion", NR_FACTURA: "15701-2-3000332", CONTRATO: "3000332", NR_CUO: "14/35", CUOTA: "375,00" },
    { NRO_CLI: "CLI-2", SUCURSAL: "Asuncion", NR_FACTURA: "15701-2-3000333", CONTRATO: "3000333", NR_CUO: "1/24", CUOTA: "860,00" },
  ];

  it("encuentra la columna de cuota real del cuotero", () => {
    expect(
      sugerirColumnaDeCuota(FILAS, HEADERS, {
        externalId: "NRO_CLI",
        loanNumber: "CONTRATO",
        invoiceNumber: "NR_FACTURA",
      }),
    ).toBe("NR_CUO");
  });

  it("prefiere la columna con forma 13/35 sobre otra que tambien sirva", () => {
    const headers = [...HEADERS, "ID_FILA"];
    const filas = FILAS.map((f, i) => ({ ...f, ID_FILA: `R${i}` }));

    // ID_FILA es unica y viene despues; igual gana NR_CUO por su forma.
    expect(
      sugerirColumnaDeCuota(filas, headers, {
        externalId: "NRO_CLI",
        loanNumber: "CONTRATO",
        invoiceNumber: "NR_FACTURA",
      }),
    ).toBe("NR_CUO");
  });

  it("nunca sugiere la columna que ya esta en uso como deudor u operacion", () => {
    const sugerida = sugerirColumnaDeCuota(FILAS, HEADERS, {
      externalId: "NRO_CLI",
      loanNumber: "CONTRATO",
      invoiceNumber: "NR_FACTURA",
    });

    expect(sugerida).not.toBe("NRO_CLI");
    expect(sugerida).not.toBe("CONTRATO");
    expect(sugerida).not.toBe("NR_FACTURA");
  });

  it("descarta una columna con huecos: no identifica una cuota", () => {
    const filas = [
      { NRO_CLI: "CLI-1", REF: "A" },
      { NRO_CLI: "CLI-1", REF: "" },
    ];

    expect(
      sugerirColumnaDeCuota(filas, ["NRO_CLI", "REF"], { externalId: "NRO_CLI" }),
    ).toBeNull();
  });

  it("devuelve null cuando ninguna columna alcanza", () => {
    const filas = [
      { NRO_CLI: "CLI-1", ZONA: "Norte" },
      { NRO_CLI: "CLI-1", ZONA: "Norte" },
    ];

    expect(
      sugerirColumnaDeCuota(filas, ["NRO_CLI", "ZONA"], { externalId: "NRO_CLI" }),
    ).toBeNull();
  });

  it("sin deudor mapeado no se puede sugerir nada", () => {
    expect(sugerirColumnaDeCuota(FILAS, HEADERS, {})).toBeNull();
  });
});
