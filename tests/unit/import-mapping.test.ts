import { describe, expect, it } from "vitest";

import type { PaymentMethod } from "@/generated/prisma/enums";
import {
  PAYMENT_METHODS,
  parsePaymentMethod,
  paymentMethodLabel,
  suggestPaymentMapping,
} from "@/lib/import/payment-config";
import { normalizeHeader } from "@/lib/import/normalize-header";
import {
  depurarMapeoGuardado,
  suggestMapping,
} from "@/lib/import/sector-config";

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

describe("suggestMapping — el dato manda sobre el encabezado", () => {
  /**
   * Los encabezados de un cuotero real. El caso que importa: conviven una
   * columna "NR_CUO" con "13/35" —el número de cuota— y otra "CUOTA" con
   * "66,00" —la plata—, más una "MONTO_APLICADO" que está toda en cero.
   *
   * Adivinando solo por nombre, "CUOTA" se llevaba el número de cuota y
   * "MONTO_APLICADO" el monto de la deuda: la cartera entera habría entrado con
   * deuda cero y las cuotas colapsadas por monto repetido.
   */
  const CUOTERO = [
    "SUCURSAL", "NR_FACTURA", "CONTRATO", "Aux_Cobranza", "NR_CUO", "CUOTA",
    "MONTO_APLICADO", "NRO_CLI", "CLIENTE", "NRO_DOCUMENTO", "CORREO",
    "TELEF1", "TELEF2", "FCH_VTO", "MONEDA", "OBSERVACION1", "NOMBRE_GARANTE",
  ];

  const FILAS = [
    {
      SUCURSAL: "Encarnación", NR_FACTURA: "15701-2-3000332", CONTRATO: "3000332",
      Aux_Cobranza: "Armando Barreto", NR_CUO: "13/35", CUOTA: "66,00",
      MONTO_APLICADO: "0,00", NRO_CLI: "30003", CLIENTE: "Ramona Benítez",
      NRO_DOCUMENTO: "3456789", CORREO: "r@ej.com.py", TELEF1: "0981555444",
      TELEF2: "0972111222", FCH_VTO: "15/08/2026", MONEDA: "USD",
      OBSERVACION1: "Cuota 13", NOMBRE_GARANTE: "Hugo Martínez",
    },
    {
      SUCURSAL: "Central", NR_FACTURA: "15701-2-3000333", CONTRATO: "3000333",
      Aux_Cobranza: "López M.", NR_CUO: "1/60", CUOTA: "1.850.000",
      MONTO_APLICADO: "0,00", NRO_CLI: "30004", CLIENTE: "Hugo Martínez",
      NRO_DOCUMENTO: "4567890", CORREO: "h@ej.com.py", TELEF1: "0982333111",
      TELEF2: "", FCH_VTO: "15/09/2026", MONEDA: "Gs.",
      OBSERVACION1: "Cuota 1", NOMBRE_GARANTE: "Ana Rojas",
    },
  ];

  it("la cuota sale de la columna con forma 13/35, no de la que se llama CUOTA", () => {
    const m = suggestMapping(CUOTERO, FILAS);
    expect(m.invoiceNumber).toBe("NR_CUO");
    expect(m.amount).toBe("CUOTA");
  });

  it("no toma como monto una columna que está toda en cero", () => {
    // MONTO_APLICADO coincide con el alias "monto" y aparece antes que CUOTA en
    // el archivo. Si ganara, toda la cartera entraría con deuda cero.
    const m = suggestMapping(CUOTERO, FILAS);
    expect(m.amount).not.toBe("MONTO_APLICADO");
  });

  it("empareja el resto del cuotero", () => {
    const m = suggestMapping(CUOTERO, FILAS);
    expect(m).toMatchObject({
      externalId: "NRO_CLI",
      name: "CLIENTE",
      documentNumber: "NRO_DOCUMENTO",
      email: "CORREO",
      phone: "TELEF1",
      phoneAlt: "TELEF2",
      loanNumber: "CONTRATO",
      dueDate: "FCH_VTO",
      currency: "MONEDA",
      description: "OBSERVACION1",
      referenceName: "NOMBRE_GARANTE",
    });
  });

  it("deja sin asignar lo que Pand no sabe guardar", () => {
    const m = suggestMapping(CUOTERO, FILAS);
    const usadas = new Set(Object.values(m));
    for (const columna of ["SUCURSAL", "Aux_Cobranza", "MONTO_APLICADO"]) {
      expect(usadas.has(columna), `${columna} no deberia mapearse`).toBe(false);
    }
  });

  it("un número de contrato pelado sigue sirviendo como identificador", () => {
    // "3000332" se puede leer como número. Lo que se rechaza para un
    // identificador es la forma de PLATA ("66,00", "1.850.000"), no cualquier
    // número: si no, el contrato quedaría sin mapear.
    const m = suggestMapping(CUOTERO, FILAS);
    expect(m.loanNumber).toBe("CONTRATO");
  });

  it("sin filas de muestra se comporta como antes, solo por nombre", () => {
    const m = suggestMapping(["NRO_CLI", "CLIENTE", "CUOTA", "FCH_VTO"]);
    expect(m.externalId).toBe("NRO_CLI");
    expect(m.name).toBe("CLIENTE");
  });

  it("con dos columnas de fecha no adivina el vencimiento a la fuerza", () => {
    const headers = ["ID", "NOMBRE", "COMPROBANTE", "MONTO", "FCH_OTORGAMIENTO", "FCH_VTO"];
    const filas = [
      {
        ID: "C-1", NOMBRE: "Ana", COMPROBANTE: "F-1", MONTO: "500.000",
        FCH_OTORGAMIENTO: "01/01/2025", FCH_VTO: "15/08/2026",
      },
    ];
    // La regla de "una sola fecha" no aplica, así que decide el alias.
    expect(suggestMapping(headers, filas).dueDate).toBe("FCH_VTO");
  });
});

/**
 * Un mapeo guardado se reaplica solo en cada carga del mismo sector. Si quedo
 * mal una vez, queda mal para siempre y nadie lo ve: por eso pasa por el mismo
 * veto que el adivinador.
 *
 * El caso real: "Nro. de cuota" apuntando a una columna de importes. Al
 * importar, dos cuotas del mismo credito compartian el "375,00" y la carga se
 * cortaba entera con un error que no mencionaba al mapeo guardado.
 */
describe("depurarMapeoGuardado", () => {
  const HEADERS = ["NRO_CLI", "CLIENTE", "NR_CUO", "CUOTA", "FCH_VTO"];
  const FILAS = [
    { NRO_CLI: "1001", CLIENTE: "Juan Perez", NR_CUO: "13/35", CUOTA: "375,00", FCH_VTO: "2026-08-15" },
    { NRO_CLI: "1002", CLIENTE: "Ana Gomez", NR_CUO: "5/24", CUOTA: "860,00", FCH_VTO: "2026-09-15" },
  ];

  it("descarta un identificador que apunta a una columna de importes", () => {
    const { mapeo, descartados } = depurarMapeoGuardado(
      { invoiceNumber: "CUOTA", name: "CLIENTE" },
      HEADERS,
      FILAS,
    );

    expect(mapeo.invoiceNumber).toBeUndefined();
    expect(mapeo.name).toBe("CLIENTE");
    expect(descartados).toEqual([
      { campo: "invoiceNumber", columna: "CUOTA", motivo: "trae importes" },
    ]);
  });

  it("descarta un vencimiento que no apunta a una columna de fechas", () => {
    const { mapeo, descartados } = depurarMapeoGuardado(
      { dueDate: "CLIENTE" },
      HEADERS,
      FILAS,
    );

    expect(mapeo.dueDate).toBeUndefined();
    expect(descartados[0]?.motivo).toBe("trae texto");
  });

  it("descarta un monto que apunta a una columna de texto", () => {
    const { mapeo } = depurarMapeoGuardado({ amount: "CLIENTE" }, HEADERS, FILAS);
    expect(mapeo.amount).toBeUndefined();
  });

  it("conserva el mapeo que si coincide con los datos", () => {
    const guardado = {
      externalId: "NRO_CLI",
      name: "CLIENTE",
      invoiceNumber: "NR_CUO",
      amount: "CUOTA",
      dueDate: "FCH_VTO",
    };
    const { mapeo, descartados } = depurarMapeoGuardado(guardado, HEADERS, FILAS);

    expect(mapeo).toEqual(guardado);
    expect(descartados).toHaveLength(0);
  });

  it("ignora columnas que este archivo no trae, sin reportarlas", () => {
    const { mapeo, descartados } = depurarMapeoGuardado(
      { name: "CLIENTE", product: "LINEA_QUE_NO_EXISTE" },
      HEADERS,
      FILAS,
    );

    expect(mapeo).toEqual({ name: "CLIENTE" });
    expect(descartados).toHaveLength(0);
  });

  it("nunca descarta un campo propio: acepta cualquier valor", () => {
    const { mapeo, descartados } = depurarMapeoGuardado(
      { "custom:sucursal": "CUOTA" },
      HEADERS,
      FILAS,
    );

    expect(mapeo["custom:sucursal"]).toBe("CUOTA");
    expect(descartados).toHaveLength(0);
  });

  it("sin filas de muestra no veta nada: no hay con que juzgar", () => {
    const { mapeo, descartados } = depurarMapeoGuardado(
      { invoiceNumber: "CUOTA" },
      HEADERS,
    );

    expect(mapeo.invoiceNumber).toBe("CUOTA");
    expect(descartados).toHaveLength(0);
  });

  it("acepta un monto todo en cero elegido a mano, que el adivinador vetaria", () => {
    // El adivinador es estricto con "montocero" porque suele ser un "aplicado"
    // sin usar. Pero si la persona lo eligio, este archivo puede traer todo en
    // cero de verdad: no se le discute.
    const filas = [{ APLICADO: "0,00" }, { APLICADO: "0,00" }];
    const { mapeo } = depurarMapeoGuardado({ amount: "APLICADO" }, ["APLICADO"], filas);

    expect(mapeo.amount).toBe("APLICADO");
  });
  /**
   * "CIUDAD" empieza con "ci" y el prefijo suelto se la llevaba a CI/RUC,
   * dejando "NRO_DOCUMENTO" —el documento de verdad— sin asignar. Un prefijo
   * solo vale si corta donde corta una palabra.
   */
  it("no confunde CIUDAD con el alias ci de CI/RUC", () => {
    const filas = [
      { NRO_CLI: "CLI-1", CIUDAD: "LUQUE", NRO_DOCUMENTO: "796273-8" },
      { NRO_CLI: "CLI-2", CIUDAD: "ASUNCION", NRO_DOCUMENTO: "123456-7" },
    ];
    const mapeo = suggestMapping(["NRO_CLI", "CIUDAD", "NRO_DOCUMENTO"], filas);

    expect(mapeo.documentNumber).toBe("NRO_DOCUMENTO");
  });

  it("un prefijo que termina en numero si vale: TELEF1 es un telefono", () => {
    const filas = [
      { TELEF1: "0981-111111", TELEF2: "0982-222222" },
      { TELEF1: "0981-333333", TELEF2: "0982-444444" },
    ];
    const mapeo = suggestMapping(["TELEF1", "TELEF2"], filas);

    expect(mapeo.phone).toBe("TELEF1");
    expect(mapeo.phoneAlt).toBe("TELEF2");
  });

  /**
   * En el cuotero real TELEF1 y TELEF2 vienen vacias de punta a punta y el
   * unico telefono con datos es el tercero. Una columna vacia no se mapea.
   */
  it("con TELEF1 y TELEF2 vacias, el telefono es TELEF3", () => {
    const filas = [
      { TELEF1: "", TELEF2: "", TELEF3: "971665535" },
      { TELEF1: "", TELEF2: "", TELEF3: "985925618" },
    ];
    const mapeo = suggestMapping(["TELEF1", "TELEF2", "TELEF3"], filas);

    expect(mapeo.phone).toBe("TELEF3");
    expect(mapeo.phoneAlt).toBeUndefined();
  });

  it("no mapea una columna vacia en todo el archivo", () => {
    // Caso real: "CONTRATO" matchea el alias de "Nro. de operacion" pero no
    // trae un solo valor, y ocuparla deja los dos creditos del mismo deudor
    // sin nada que los separe.
    const filas = [
      { NRO_CLI: "CLI-1", CONTRATO: "", NR_FACTURA: "92291-038-001-0000352" },
      { NRO_CLI: "CLI-1", CONTRATO: "", NR_FACTURA: "92880-038-001-0000356" },
    ];
    const mapeo = suggestMapping(["NRO_CLI", "CONTRATO", "NR_FACTURA"], filas);

    expect(mapeo.loanNumber).toBeUndefined();
  });

  it("descarta del mapeo guardado una columna que este archivo trae vacia", () => {
    const filas = [{ CONTRATO: "" }, { CONTRATO: "" }];
    const { mapeo, descartados } = depurarMapeoGuardado(
      { loanNumber: "CONTRATO" },
      ["CONTRATO"],
      filas,
    );

    expect(mapeo.loanNumber).toBeUndefined();
    expect(descartados).toEqual([
      { campo: "loanNumber", columna: "CONTRATO", motivo: "viene vacía" },
    ]);
  });
});
