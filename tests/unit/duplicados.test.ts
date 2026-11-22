import { describe, expect, it } from "vitest";

import { apartarRepetidas, sugerirArreglo } from "@/lib/import/duplicados";
import type { MappedRow } from "@/lib/import/row-schema";
import type { ValidationOutcome } from "@/lib/import/validate-rows";

/**
 * El caso real que motiva todo esto: un cuotero trae "NR_FACTURA" con
 * "15701-2-3000332" —el numero del credito, igual en las 35 cuotas— y "NR_CUO"
 * con "13/35", que es la cuota de verdad. Mapear la primera hace que las 35
 * filas digan ser la misma deuda.
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

/** Lo que devuelve `validateRows`, para poder apartarle las repetidas. */
function validado(filas: MappedRow[], numeros?: number[]): ValidationOutcome {
  return {
    valid: filas,
    // +2: la fila 1 son los encabezados y los humanos cuentan desde 1.
    numeros: numeros ?? filas.map((_, i) => i + 2),
    errors: [],
    avisos: [],
  };
}

describe("apartarRepetidas", () => {
  it("no aparta nada cuando cada cuota es distinta", () => {
    const r = apartarRepetidas(
      validado([
        fila({ invoiceNumber: "13/35", amount: 375_000 }),
        fila({ invoiceNumber: "14/35", amount: 380_000 }),
      ]),
    );

    expect(r.repetidas).toBeNull();
    expect(r.valid).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });

  it("la fila repetida identica se deduplica sin avisar", () => {
    const r = apartarRepetidas(validado([fila(), fila()]));

    expect(r.repetidas).toBeNull();
    expect(r.valid).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });

  /**
   * Lo importante: entra la primera y se saltea la segunda. Antes esto frenaba
   * la carga entera, y en una cartera real de 7.800 filas siempre hay un par
   * ambiguas: exigir cero era exigir que no se importe nada.
   */
  it("deja entrar la primera y saltea la segunda, reportandola", () => {
    const r = apartarRepetidas(
      validado([
        fila({ invoiceNumber: "15701-2-3000332", amount: 375_000 }),
        fila({ invoiceNumber: "15701-2-3000332", amount: 412_000 }),
      ]),
    );

    expect(r.valid).toHaveLength(1);
    expect(r.valid[0].amount).toBe(375_000);
    expect(r.repetidas).toMatchObject({
      externalId: "CLI-PF-1956960",
      invoiceNumber: "15701-2-3000332",
      total: 1,
      filas: [2, 3],
    });
    expect(r.errors).toEqual([
      {
        row: 3,
        field: "Deuda repetida",
        message: "la misma cuota ya vino en la fila 2 con otro monto o vencimiento",
      },
    ]);
  });

  it("cuenta todas las salteadas pero describe solo la primera", () => {
    const r = apartarRepetidas(
      validado([
        fila({ invoiceNumber: "A", amount: 1 }),
        fila({ invoiceNumber: "A", amount: 2 }),
        fila({ invoiceNumber: "B", amount: 3 }),
        fila({ invoiceNumber: "B", amount: 4 }),
      ]),
    );

    expect(r.repetidas?.invoiceNumber).toBe("A");
    expect(r.repetidas?.total).toBe(2);
    expect(r.valid).toHaveLength(2);
    expect(r.errors).toHaveLength(2);
  });

  /**
   * Los numeros vienen de `validateRows` y no de la posicion dentro de `valid`:
   * si la validacion descarto filas del medio, contar sobre `valid` daba un
   * numero que no existe en la planilla que la persona tiene abierta.
   */
  it("reporta el numero de fila de la planilla, no la posicion en la lista", () => {
    const r = apartarRepetidas(
      validado(
        [
          fila({ invoiceNumber: "A", amount: 1 }),
          fila({ invoiceNumber: "A", amount: 2 }),
        ],
        [4982, 4992],
      ),
    );

    expect(r.repetidas?.filas).toEqual([4982, 4992]);
    expect(r.errors[0].row).toBe(4992);
  });

  it("la operacion separa dos creditos con la misma cuota", () => {
    const r = apartarRepetidas(
      validado([
        fila({ loanNumber: "3000332", invoiceNumber: "1/35", amount: 375_000 }),
        fila({ loanNumber: "3000999", invoiceNumber: "1/35", amount: 412_000 }),
      ]),
    );

    expect(r.repetidas).toBeNull();
    expect(r.valid).toHaveLength(2);
  });

  it("sin operacion mapeada, dos creditos del mismo deudor chocan", () => {
    const r = apartarRepetidas(
      validado([
        fila({ invoiceNumber: "1/35", amount: 375_000 }),
        fila({ invoiceNumber: "1/35", amount: 412_000 }),
      ]),
    );

    expect(r.repetidas?.total).toBe(1);
  });

  it("dos deudores pueden tener la misma cuota: no es un choque", () => {
    const r = apartarRepetidas(
      validado([
        fila({ externalId: "CLI-1", invoiceNumber: "1/60", amount: 100 }),
        fila({ externalId: "CLI-2", invoiceNumber: "1/60", amount: 200 }),
      ]),
    );

    expect(r.repetidas).toBeNull();
    expect(r.valid).toHaveLength(2);
  });

  it("la moneda distingue dos deudas con la misma cifra", () => {
    const r = apartarRepetidas(
      validado([
        fila({ invoiceNumber: "1/35", amount: 500, currency: "PYG" }),
        fila({ invoiceNumber: "1/35", amount: 500, currency: "USD" }),
      ]),
    );

    expect(r.repetidas?.total).toBe(1);
  });

  it("conserva los errores y avisos que ya traia la validacion", () => {
    const base = validado([fila()]);
    base.errors.push({ row: 9, field: "Monto", message: "vacío" });
    base.avisos.push({ field: "Telef3", count: 175, ejemplo: "0985-925618" });

    const r = apartarRepetidas(base);

    expect(r.errors).toHaveLength(1);
    expect(r.avisos).toHaveLength(1);
  });
});

describe("sugerirArreglo", () => {
  // El cuotero de la captura: NR_FACTURA repite por credito, NR_CUO no.
  const HEADERS = [
    "NRO_CLI", "SUCURSAL", "NR_FACTURA", "CONTRATO", "NR_CUO", "CUOTA", "FCH_VTO",
  ];
  const FILAS = [
    { NRO_CLI: "CLI-1", SUCURSAL: "Encarnacion", NR_FACTURA: "15701-2-3000332", CONTRATO: "3000332", NR_CUO: "13/35", CUOTA: "375,00", FCH_VTO: "2026-08-15" },
    { NRO_CLI: "CLI-1", SUCURSAL: "Encarnacion", NR_FACTURA: "15701-2-3000332", CONTRATO: "3000332", NR_CUO: "14/35", CUOTA: "380,00", FCH_VTO: "2026-09-15" },
    { NRO_CLI: "CLI-2", SUCURSAL: "Asuncion", NR_FACTURA: "15701-2-3000333", CONTRATO: "3000333", NR_CUO: "1/24", CUOTA: "860,00", FCH_VTO: "2026-08-15" },
  ];

  /** El mapeo que produce el choque: la cuota apunta al numero del credito. */
  const MAL = {
    externalId: "NRO_CLI",
    loanNumber: "CONTRATO",
    invoiceNumber: "NR_FACTURA",
    amount: "CUOTA",
    dueDate: "FCH_VTO",
  };

  it("encuentra la columna de cuota real del cuotero", () => {
    expect(sugerirArreglo(FILAS, HEADERS, MAL)).toMatchObject({
      rol: "invoiceNumber",
      columna: "NR_CUO",
      antes: 1,
      restantes: 0,
      vacias: 0,
    });
  });

  it("prefiere la columna con forma 13/35 sobre otra que tambien sirva", () => {
    const headers = [...HEADERS, "ID_FILA"];
    const filas = FILAS.map((f, i) => ({ ...f, ID_FILA: `R${i}` }));

    // ID_FILA tambien deja todo distinto; gana NR_CUO por su forma.
    expect(sugerirArreglo(filas, headers, MAL)?.columna).toBe("NR_CUO");
  });

  it("nunca sugiere la columna que ya esta en uso como deudor u operacion", () => {
    const sugerida = sugerirArreglo(FILAS, HEADERS, MAL)?.columna;

    expect(sugerida).not.toBe("NRO_CLI");
    expect(sugerida).not.toBe("CONTRATO");
    expect(sugerida).not.toBe("NR_FACTURA");
  });

  /**
   * El caso que rompio la primera version. En el archivo real de 44 columnas
   * alguna fila viene sucia, y descartar la columna entera al primer defecto
   * dejaba la pantalla diciendo "ninguna columna sirve" con la correcta al lado.
   */
  it("sigue sugiriendo la columna correcta aunque una fila venga sin valor", () => {
    const filas = [
      ...FILAS,
      ...FILAS.map((f) => ({ ...f, NRO_CLI: "CLI-4" })),
      ...FILAS.map((f) => ({ ...f, NRO_CLI: "CLI-5" })),
      { NRO_CLI: "CLI-3", SUCURSAL: "Itaugua", NR_FACTURA: "15701-2-3000334", CONTRATO: "3000334", NR_CUO: "", CUOTA: "120,00", FCH_VTO: "2026-10-15" },
      { NRO_CLI: "CLI-3", SUCURSAL: "Itaugua", NR_FACTURA: "15701-2-3000334", CONTRATO: "3000334", NR_CUO: "2/24", CUOTA: "121,00", FCH_VTO: "2026-11-15" },
    ];

    const s = sugerirArreglo(filas, HEADERS, MAL);
    expect(s?.columna).toBe("NR_CUO");
    expect(s?.vacias).toBe(1);
  });

  it("sigue sugiriendola aunque deje algun choque sin resolver", () => {
    // Dos filas distintas comparten la cuota 13/35 del mismo credito: ni
    // NR_CUO lo arregla del todo. Igual es la mejor, y se dice cuanto queda.
    const filas = [
      ...FILAS,
      ...FILAS.map((f) => ({ ...f, NRO_CLI: "CLI-4" })),
      { NRO_CLI: "CLI-1", SUCURSAL: "Encarnacion", NR_FACTURA: "15701-2-3000332", CONTRATO: "3000332", NR_CUO: "13/35", CUOTA: "999,00", FCH_VTO: "2026-11-15" },
    ];

    const s = sugerirArreglo(filas, HEADERS, MAL);
    expect(s?.columna).toBe("NR_CUO");
    expect(s?.restantes).toBe(1);
  });

  it("no sugiere nada cuando las filas repetidas son identicas", () => {
    // Se deduplican solas: no hay choque que resolver.
    expect(sugerirArreglo([FILAS[0], { ...FILAS[0] }], HEADERS, MAL)).toBeNull();
  });

  it("no sugiere nada si no mejora lo que ya esta mapeado", () => {
    expect(
      sugerirArreglo(FILAS, HEADERS, { ...MAL, invoiceNumber: "NR_CUO" }),
    ).toBeNull();
  });

  it("sin deudor mapeado no se puede sugerir nada", () => {
    expect(sugerirArreglo(FILAS, HEADERS, {})).toBeNull();
  });

  /**
   * Una columna de plata casi nunca repite, asi que gana cualquier ranking por
   * unicidad. Sugerirla seria proponer el error que esto existe para evitar.
   */
  it("nunca sugiere una columna con forma de plata", () => {
    const headers = ["NRO_CLI", "NR_FACTURA", "SALDO"];
    const filas = [
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-1", SALDO: "1.250.000" },
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-1", SALDO: "860.000" },
    ];

    // Hay choque —F-1 dos veces con saldos distintos— y SALDO lo resolveria,
    // pero no es un numero de cuota ni de credito.
    expect(
      sugerirArreglo(filas, headers, {
        externalId: "NRO_CLI",
        invoiceNumber: "NR_FACTURA",
        amount: "SALDO",
      }),
    ).toBeNull();
  });

  it("descarta una columna vacia en todo el archivo", () => {
    const headers = ["NRO_CLI", "NR_FACTURA", "CONTRATO", "SALDO"];
    const filas = [
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-1", CONTRATO: "", SALDO: "100" },
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-1", CONTRATO: "", SALDO: "200" },
    ];

    expect(
      sugerirArreglo(filas, headers, {
        externalId: "NRO_CLI",
        invoiceNumber: "NR_FACTURA",
        amount: "SALDO",
      }),
    ).toBeNull();
  });

  /**
   * El caso real de "Caso 1.xlsx": el mismo deudor compro un T-CROSS y un
   * POLO TRACK, los dos a 60 cuotas, y los dos van por la cuota 27/60 con el
   * mismo vencimiento. Las dos deudas son reales. Lo que las separa es
   * NR_FACTURA, el numero del credito —y "CONTRATO", el alias obvio para la
   * operacion, viene vacia de punta a punta.
   *
   * Lo que falta no es cambiar la cuota: es mapear la operacion.
   */
  it("propone mapear la operacion cuando el deudor tiene dos creditos", () => {
    const headers = ["NRO_CLI", "NR_FACTURA", "CONTRATO", "NR_CUO", "CUOTA", "FCH_VTO"];
    const filas = [
      { NRO_CLI: "CLI-PF-796273", NR_FACTURA: "92291-038-001-0000352", CONTRATO: "", NR_CUO: "27/60", CUOTA: "260,00", FCH_VTO: "11/3/26" },
      { NRO_CLI: "CLI-PF-796273", NR_FACTURA: "92880-038-001-0000356", CONTRATO: "", NR_CUO: "27/60", CUOTA: "180,00", FCH_VTO: "11/3/26" },
    ];

    expect(
      sugerirArreglo(filas, headers, {
        externalId: "NRO_CLI",
        invoiceNumber: "NR_CUO",
        amount: "CUOTA",
        dueDate: "FCH_VTO",
      }),
    ).toMatchObject({
      rol: "loanNumber",
      columna: "NR_FACTURA",
      antes: 1,
      restantes: 0,
      vacias: 0,
    });
  });

  /**
   * NOMBRE_GARANTE llego a ganar el ranking en el archivo real: resolvia los
   * choques porque venia vacia en 7.695 filas, no porque identificara nada.
   * Tomarla como numero de cuota habria descartado casi toda la cartera.
   */
  it("nunca gana una columna casi vacia, aunque resuelva los choques", () => {
    const headers = ["NRO_CLI", "NR_CUO", "NOMBRE_GARANTE", "CUOTA"];
    const filas: Record<string, string>[] = Array.from({ length: 10 }, (_, i) => ({
      NRO_CLI: "CLI-1",
      NR_CUO: `${i + 1}/10`,
      NOMBRE_GARANTE: "",
      CUOTA: `${100 + i},00`,
    }));
    // Dos choques, y el garante aparece justo en esas dos filas: los arreglaria.
    filas.push(
      { NRO_CLI: "CLI-1", NR_CUO: "1/10", NOMBRE_GARANTE: "PEREZ", CUOTA: "999,00" },
      { NRO_CLI: "CLI-1", NR_CUO: "2/10", NOMBRE_GARANTE: "GOMEZ", CUOTA: "998,00" },
    );

    expect(
      sugerirArreglo(filas, headers, {
        externalId: "NRO_CLI",
        invoiceNumber: "NR_CUO",
        amount: "CUOTA",
      }),
    ).toBeNull();
  });
  /**
   * El caso del "Cuotero DIESA": "CONTRATO" matchea el alias de "Nro. de
   * operacion" pero viene vacia en 3.474 de 7.803 filas, asi que los dos
   * creditos de un mismo deudor quedan los dos sin operacion y chocan. La
   * columna que si los separa es "NR_FACTURA", y no se llegaba a probar porque
   * el puesto ya estaba ocupado: la pantalla decia "ninguna columna mejora
   * esto" teniendo la correcta al lado.
   */
  it("propone cambiar la operacion aunque ya este mapeada a otra columna", () => {
    const headers = ["NRO_CLI", "NR_FACTURA", "CONTRATO", "NR_CUO", "CUOTA", "FCH_VTO"];
    const filas = [
      // Dos creditos del mismo deudor, los dos sin CONTRATO: con esa columna
      // como operacion, las dos cuotas 1/60 dicen ser la misma deuda.
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-100", CONTRATO: "", NR_CUO: "1/60", CUOTA: "260,00", FCH_VTO: "2026-11-03" },
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-100", CONTRATO: "", NR_CUO: "2/60", CUOTA: "260,00", FCH_VTO: "2026-12-03" },
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-200", CONTRATO: "", NR_CUO: "1/60", CUOTA: "180,00", FCH_VTO: "2026-11-03" },
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-200", CONTRATO: "", NR_CUO: "2/60", CUOTA: "180,00", FCH_VTO: "2026-12-03" },
      // Otro deudor donde CONTRATO si viene: la columna no esta vacia entera.
      { NRO_CLI: "CLI-2", NR_FACTURA: "F-300", CONTRATO: "26775", NR_CUO: "1/60", CUOTA: "500,00", FCH_VTO: "2026-11-03" },
    ];

    expect(
      sugerirArreglo(filas, headers, {
        externalId: "NRO_CLI",
        loanNumber: "CONTRATO",
        invoiceNumber: "NR_CUO",
        amount: "CUOTA",
        dueDate: "FCH_VTO",
      }),
    ).toMatchObject({
      rol: "loanNumber",
      columna: "NR_FACTURA",
      antes: 2,
      restantes: 0,
    });
  });

  /**
   * Cualquier columna con un valor distinto por fila "arregla" los choques
   * usada como operacion: dice que cada fila es un credito aparte. Es cierto y
   * es inutil. La forma "13/35" gana ante la misma mejora.
   */
  it("prefiere la cuota con forma 13/35 antes que un id unico por fila", () => {
    const headers = ["NRO_CLI", "NR_FACTURA", "NR_CUO", "ID_FILA", "CUOTA"];
    const filas = [
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-100", NR_CUO: "1/60", ID_FILA: "R1", CUOTA: "260,00" },
      { NRO_CLI: "CLI-1", NR_FACTURA: "F-100", NR_CUO: "2/60", ID_FILA: "R2", CUOTA: "270,00" },
    ];

    expect(
      sugerirArreglo(filas, headers, {
        externalId: "NRO_CLI",
        invoiceNumber: "NR_FACTURA",
        amount: "CUOTA",
      }),
    ).toMatchObject({ rol: "invoiceNumber", columna: "NR_CUO" });
  });
});
