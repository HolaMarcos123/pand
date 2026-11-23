import { describe, expect, it } from "vitest";

import { constantes, porOperacion, type Cuota } from "@/lib/clients/ficha";

/**
 * El caso real: el cuotero de DIESA trae una fila por cuota, y en cada una
 * repite el telefono, el conyuge y el barrio del deudor. Con 48 cuotas, la
 * ficha mostraba "Telef3: 986641264" cuarenta y ocho veces.
 */
function cuota(extra: Partial<Cuota> = {}): Cuota {
  return {
    id: crypto.randomUUID(),
    invoiceNumber: "43/48",
    loanNumber: "10049-033-001-0000547",
    propios: [],
    portfolioName: "Cuotero DIESA",
    product: null,
    description: null,
    amount: 654_000,
    paidAmount: 0,
    currency: "PYG",
    dueDate: "2026-11-26",
    daysOverdue: 0,
    status: "PENDING",
    ...extra,
  } as Cuota;
}

const propio = (label: string, valor: string) => ({ label, valor });

describe("constantes", () => {
  it("separa lo que describe al deudor de lo que cambia en cada cuota", () => {
    const cuotas = [
      cuota({
        invoiceNumber: "43/48",
        propios: [propio("Telef3", "986641264"), propio("Saldo cuota", "654000")],
      }),
      cuota({
        invoiceNumber: "44/48",
        propios: [propio("Telef3", "986641264"), propio("Saldo cuota", "600000")],
      }),
    ];

    const { datos, etiquetas } = constantes(cuotas);

    expect(datos).toEqual([propio("Telef3", "986641264")]);
    expect(etiquetas.has("Telef3")).toBe(true);
    expect(etiquetas.has("Saldo cuota")).toBe(false);
  });

  /**
   * Con una sola cuota todo parece constante y no hay nada que deducir: no hay
   * repeticion que sacar de las cuotas, y adivinar mal mandaria el saldo de la
   * cuota al encabezado del deudor.
   */
  it("con una sola cuota no deduce nada", () => {
    const { datos, etiquetas } = constantes([
      cuota({ propios: [propio("Saldo cuota", "654000")] }),
    ]);

    expect(datos).toEqual([]);
    expect(etiquetas.size).toBe(0);
  });

  it("un campo que solo trae una de las cuotas igual es constante", () => {
    const cuotas = [
      cuota({ propios: [propio("Cónyuge", "BENITEZ, CYNTHIA")] }),
      cuota({ propios: [] }),
    ];

    expect(constantes(cuotas).datos).toEqual([propio("Cónyuge", "BENITEZ, CYNTHIA")]);
  });

  it("respeta el orden en que vienen los campos", () => {
    const campos = [propio("Sucursal", "Botánico"), propio("Telef3", "9866")];
    const cuotas = [cuota({ propios: campos }), cuota({ propios: campos })];

    expect(constantes(cuotas).datos.map((d) => d.label)).toEqual([
      "Sucursal",
      "Telef3",
    ]);
  });

  it("sin campos propios no devuelve nada", () => {
    expect(constantes([cuota(), cuota()]).datos).toEqual([]);
  });
});

describe("porOperacion", () => {
  it("agrupa las cuotas por credito, en el orden en que aparecen", () => {
    const grupos = porOperacion([
      cuota({ loanNumber: "F-100", invoiceNumber: "1/48" }),
      cuota({ loanNumber: "F-200", invoiceNumber: "1/60" }),
      cuota({ loanNumber: "F-100", invoiceNumber: "2/48" }),
    ]);

    expect(grupos.map((g) => g.loanNumber)).toEqual(["F-100", "F-200"]);
    expect(grupos[0].cuotas).toHaveLength(2);
  });

  /**
   * Un deudor puede tener una prenda en dolares y una tarjeta en guaranies, y
   * el encabezado de la operacion tiene que decir en cual esta: mostrar una
   * cuota de USD 654 como "Gs. 654" la hace 7.000 veces mas chica.
   */
  it("junta las monedas de la operacion, sin repetirlas", () => {
    const grupos = porOperacion([
      cuota({ loanNumber: "F-100", currency: "PYG" }),
      cuota({ loanNumber: "F-100", currency: "USD" }),
      cuota({ loanNumber: "F-100", currency: "PYG" }),
    ]);

    expect(grupos[0].monedas).toEqual(["PYG", "USD"]);
  });

  it("toma el producto de la primera cuota que lo traiga", () => {
    const grupos = porOperacion([
      cuota({ loanNumber: "F-100", product: null }),
      cuota({ loanNumber: "F-100", product: "T-CROSS 1.4 AT HL" }),
    ]);

    expect(grupos[0].product).toBe("T-CROSS 1.4 AT HL");
  });

  it("las cuotas sin operacion quedan en un grupo propio", () => {
    const grupos = porOperacion([
      cuota({ loanNumber: "" }),
      cuota({ loanNumber: "F-100" }),
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos[0].loanNumber).toBe("");
  });
});
