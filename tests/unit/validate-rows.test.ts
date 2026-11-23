import { describe, expect, it } from "vitest";

import { fieldsFor } from "@/lib/import/sector-config";
import { validatePaymentRows } from "@/lib/import/validate-payments";
import { validateRows } from "@/lib/import/validate-rows";

/**
 * La validación del importador decide qué entra a la cartera de un cliente.
 *
 * Lo que más importa acá no es que acepte lo bueno, sino que rechace lo malo con
 * un número de fila que la persona pueda encontrar en su Excel.
 */

const CAMPOS = fieldsFor("FINANCIAL");

const MAPEO = {
  externalId: "ID",
  name: "Nombre",
  documentNumber: "CI",
  invoiceNumber: "Comprobante",
  product: "Producto",
  amount: "Monto",
  dueDate: "Vencimiento",
};

function fila(extra: Record<string, unknown> = {}) {
  return {
    ID: "C-1",
    Nombre: "Juan Pérez",
    CI: "1234567",
    Comprobante: "F-1",
    Producto: "Crédito personal",
    Monto: "1.500.000",
    Vencimiento: "2026-08-15",
    ...extra,
  };
}

describe("validateRows — cartera", () => {
  it("acepta una fila completa y normaliza el monto con separador local", () => {
    const { valid, errors } = validateRows([fila()], MAPEO, CAMPOS);

    expect(errors).toHaveLength(0);
    expect(valid[0]?.amount).toBe(1_500_000);
    expect(valid[0]?.product).toBe("Crédito personal");
    expect(valid[0]?.dueDate).toBe("2026-08-15");
  });

  it("el número de fila coincide con el de Excel", () => {
    // La fila 1 son los encabezados, así que la primera fila de datos es la 2.
    // Si esto se corre, la persona busca el error en la fila equivocada.
    const { errors } = validateRows([fila({ Monto: "" })], MAPEO, CAMPOS);
    expect(errors[0]?.row).toBe(2);
  });

  it("un campo obligatorio vacío corta la fila y la explica", () => {
    const { valid, errors } = validateRows([fila({ Nombre: "" })], MAPEO, CAMPOS);
    expect(valid).toHaveLength(0);
    expect(errors[0]?.message).toBe("vacío");
  });

  it("el producto es opcional: sin producto la fila entra igual", () => {
    const { valid, errors } = validateRows([fila({ Producto: "" })], MAPEO, CAMPOS);
    expect(errors).toHaveLength(0);
    expect(valid[0]?.product).toBeNull();
  });

  it("una fila mala no arrastra a las buenas", () => {
    const { valid, errors } = validateRows(
      [fila(), fila({ Monto: "no es un número" }), fila({ ID: "C-3" })],
      MAPEO,
      CAMPOS,
    );
    expect(valid).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.row).toBe(3);
  });
});

describe("validatePaymentRows — cobros", () => {
  const MAPEO_COBROS = {
    matchExternalId: "Cliente",
    amount: "Importe",
    paymentDate: "Fecha",
    reference: "Referencia",
    method: "Forma de Pago",
  };

  const cobro = (extra: Record<string, unknown> = {}) => ({
    Cliente: "C-1",
    Importe: "250000",
    Fecha: "2026-08-20",
    Referencia: "REC-1",
    "Forma de Pago": "Bancard",
    ...extra,
  });

  it("acepta un cobro y reconoce el medio de pago local", () => {
    const { valid, errors } = validatePaymentRows([cobro()], MAPEO_COBROS);
    expect(errors).toHaveLength(0);
    expect(valid[0]?.amount).toBe(250_000);
    expect(valid[0]?.method).toBe("BANCARD");
  });

  it("rechaza un importe negativo o cero", () => {
    // Un negativo en una planilla de cobros casi siempre es una nota de crédito
    // mal exportada. Aplicarlo bajaría deuda que nadie pagó.
    for (const importe of ["-50000", "0"]) {
      const { valid, errors } = validatePaymentRows([cobro({ Importe: importe })], MAPEO_COBROS);
      expect(valid).toHaveLength(0);
      expect(errors).toHaveLength(1);
    }
  });

  it("sin ID ni documento no se puede saber a quién imputar", () => {
    const { valid, errors } = validatePaymentRows(
      [cobro({ Cliente: "" })],
      MAPEO_COBROS,
    );
    expect(valid).toHaveLength(0);
    expect(errors[0]?.field).toBe("Deudor");
  });

  it("sin medio de pago cae en OTHER en vez de rechazar el cobro", () => {
    const { valid, errors } = validatePaymentRows(
      [cobro({ "Forma de Pago": "" })],
      MAPEO_COBROS,
    );
    expect(errors).toHaveLength(0);
    expect(valid[0]?.method).toBe("OTHER");
  });
});

describe("validateRows — moneda", () => {
  const MAPEO_CON_MONEDA = { ...MAPEO, currency: "Moneda" };

  it("normaliza el código, el símbolo y el nombre", () => {
    const casos: [string, string][] = [
      ["USD", "USD"],
      ["us$", "USD"],
      ["U$S", "USD"],
      ["dólares", "USD"],
      ["$", "USD"],
      ["Gs.", "PYG"],
      ["gs", "PYG"],
      ["₲", "PYG"],
      ["Guaraníes", "PYG"],
      ["PYG", "PYG"],
    ];

    for (const [escrito, esperado] of casos) {
      const { valid, errors } = validateRows(
        [fila({ Moneda: escrito })],
        MAPEO_CON_MONEDA,
        CAMPOS,
      );
      expect(errors, `"${escrito}" deberia entrar`).toHaveLength(0);
      expect(valid[0]?.currency, `"${escrito}"`).toBe(esperado);
    }
  });

  it("una moneda vacía la resuelve el servidor, no el parser", () => {
    const { valid, errors } = validateRows(
      [fila({ Moneda: "" })],
      MAPEO_CON_MONEDA,
      CAMPOS,
    );
    expect(errors).toHaveLength(0);
    // Nulo, no "PYG": la moneda de la organización la pone el servidor, que es
    // el único que la conoce.
    expect(valid[0]?.currency).toBeNull();
  });

  it("una moneda que no se entiende descarta la fila en vez de adivinar", () => {
    // Si la columna está mapeada pero el valor no se reconoce, caer a la moneda
    // de la organización convertiría una deuda en dólares en una 7.000 veces
    // más chica, sin que nadie se entere.
    const { valid, errors } = validateRows(
      [fila({ Moneda: "euros" })],
      MAPEO_CON_MONEDA,
      CAMPOS,
    );
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("Moneda");
    expect(errors[0]?.message).toContain("euros");
    // Con el número de fila que la persona ve en Excel.
    expect(errors[0]?.row).toBe(2);
  });

  it("sin la columna mapeada no exige nada", () => {
    const { valid, errors } = validateRows([fila()], MAPEO, CAMPOS);
    expect(errors).toHaveLength(0);
    expect(valid[0]?.currency).toBeNull();
  });
});

/**
 * Un campo propio es un dato accesorio: va al `metadata` del comprobante y Pand
 * no hace cuentas con el. Si el tipo declarado no le queda, el problema es el
 * tipo, no la deuda — asi que la fila tiene que entrar igual.
 *
 * El caso real: una columna "Telef3" declarada como numero recibia
 * "0985-925618" y descartaba 175 cuotas de una cartera de 4.833.
 */
describe("validateRows — campos propios", () => {
  const CAMPOS_CON_TELEFONO = fieldsFor("FINANCIAL", [
    { id: "telef3", label: "Telef3", tipo: "numero", enFicha: true },
  ]);
  const MAPEO_CON_TELEFONO = { ...MAPEO, "custom:telef3": "Telef3" };

  it("no descarta la fila cuando el valor no entra en el tipo declarado", () => {
    const { valid, errors } = validateRows(
      [fila({ Telef3: "0985-925618" })],
      MAPEO_CON_TELEFONO,
      CAMPOS_CON_TELEFONO,
    );

    expect(errors).toHaveLength(0);
    expect(valid).toHaveLength(1);
  });

  it("conserva el valor crudo como texto en vez de perderlo", () => {
    const { valid } = validateRows(
      [fila({ Telef3: "0985-925618" })],
      MAPEO_CON_TELEFONO,
      CAMPOS_CON_TELEFONO,
    );

    expect(valid[0]?.custom).toEqual({ telef3: "0985-925618" });
  });

  it("avisa una sola vez por campo, con la cuenta y un ejemplo", () => {
    const { avisos } = validateRows(
      [
        fila({ Telef3: "0985-925618" }),
        fila({ Telef3: "0981-111222" }),
        fila({ Telef3: "0982-333444" }),
      ],
      MAPEO_CON_TELEFONO,
      CAMPOS_CON_TELEFONO,
    );

    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({
      field: "Telef3",
      count: 3,
      ejemplo: "0985-925618",
    });
  });

  it("no avisa cuando el valor si entra en el tipo", () => {
    const { avisos, valid } = validateRows(
      [fila({ Telef3: "985925618" })],
      MAPEO_CON_TELEFONO,
      CAMPOS_CON_TELEFONO,
    );

    expect(avisos).toHaveLength(0);
    expect(valid[0]?.custom).toEqual({ telef3: 985925618 });
  });

  it("un campo de Pand con el mismo problema si descarta la fila", () => {
    // El contraste importa: aflojar con los campos propios no puede aflojar
    // con el monto de la deuda, que es lo que se gestiona.
    const { valid, errors } = validateRows(
      [fila({ Monto: "0985-925618" })],
      MAPEO,
      CAMPOS,
    );

    expect(valid).toHaveLength(0);
    expect(errors[0]?.field).toBe("Monto de la cuota");
  });

  it("una fecha propia que no se entiende tampoco descarta la fila", () => {
    const campos = fieldsFor("FINANCIAL", [
      { id: "ultima_visita", label: "Última visita", tipo: "fecha", enFicha: true },
    ]);

    const { valid, avisos } = validateRows(
      [fila({ Visita: "sin datos" })],
      { ...MAPEO, "custom:ultima_visita": "Visita" },
      campos,
    );

    expect(valid).toHaveLength(1);
    expect(valid[0]?.custom).toEqual({ ultima_visita: "sin datos" });
    expect(avisos[0]?.field).toBe("Última visita");
  });
});
