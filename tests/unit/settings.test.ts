import { describe, expect, it } from "vitest";

import type { ActionResult, ActionType } from "@/generated/prisma/enums";
import {
  SETTINGS_POR_DEFECTO,
  labelResultado,
  labelTipo,
  resolverSettings,
  resolverTipificaciones,
  resultadosDe,
  tiposCargables,
} from "@/lib/config/settings";
import {
  ACTION_RESULT_LABELS,
  ACTION_TYPE_LABELS,
  MANUAL_ACTION_TYPES,
  RESULTS_BY_TYPE,
} from "@/lib/tasks/action-config";

/**
 * La configuración vive en una columna JSON, así que lo que entra no tiene forma
 * garantizada: puede faltar, sobrar, venir de una versión vieja o estar corrupta.
 *
 * La regla que fijan estos tests es una sola: leer la configuración nunca puede
 * fallar. Una clave rota deja un valor por defecto, no una pantalla en blanco.
 */

describe("resolverSettings — tolera cualquier cosa", () => {
  const basura: unknown[] = [
    undefined,
    null,
    {},
    "una cadena",
    42,
    [],
    { currency: 123 },
    { currency: "XYZ" },
    { timezone: "Marte/Olympus" },
    { tipificaciones: "rota" },
    { tipificaciones: { tipos: { NO_EXISTE: { label: "x" } } } },
  ];

  it.each(basura.map((v) => [JSON.stringify(v) ?? "undefined", v] as const))(
    "con %s devuelve una configuración usable",
    (_etiqueta, valor) => {
      const settings = resolverSettings(valor);
      expect(settings.currency).toBe(SETTINGS_POR_DEFECTO.currency);
      expect(settings.timezone).toBe(SETTINGS_POR_DEFECTO.timezone);
      expect(settings.tipificaciones.tipos.length).toBeGreaterThan(0);
    },
  );

  it("respeta lo que sí es válido", () => {
    const settings = resolverSettings({
      currency: "USD",
      timezone: "America/Sao_Paulo",
    });
    expect(settings.currency).toBe("USD");
    expect(settings.timezone).toBe("America/Sao_Paulo");
  });

  it("una clave inválida no se lleva puestas a las válidas", () => {
    // El importador escribe columnMappings en la misma columna: una clave que el
    // esquema no conoce no puede invalidar el resto.
    const settings = resolverSettings({
      currency: "USD",
      columnMappings: { FINANCIAL: { nombre: "Nombre" } },
    });
    expect(settings.currency).toBe("USD");
  });
});

describe("tipificaciones por defecto", () => {
  const config = resolverTipificaciones(undefined);

  it("sin configuración, son las de fábrica", () => {
    for (const tipo of Object.keys(ACTION_TYPE_LABELS) as ActionType[]) {
      expect(labelTipo(config, tipo)).toBe(ACTION_TYPE_LABELS[tipo]);
      expect(resultadosDe(config, tipo)).toEqual(RESULTS_BY_TYPE[tipo]);
    }
    for (const resultado of Object.keys(ACTION_RESULT_LABELS) as ActionResult[]) {
      expect(labelResultado(config, resultado)).toBe(ACTION_RESULT_LABELS[resultado]);
    }
  });

  it("los tipos cargables son los manuales", () => {
    expect(tiposCargables(config).map((t) => t.tipo).sort()).toEqual(
      [...MANUAL_ACTION_TYPES].sort(),
    );
  });

  it("las notas no llevan resultado", () => {
    expect(resultadosDe(config, "NOTE")).toEqual([]);
  });
});

describe("tipificaciones configuradas", () => {
  it("renombra un tipo y un resultado", () => {
    const config = resolverTipificaciones({
      tipos: { CALL: { label: "Gestión telefónica" } },
      etiquetasResultado: { NO_ANSWER: "No contesta" },
    });

    expect(labelTipo(config, "CALL")).toBe("Gestión telefónica");
    expect(labelResultado(config, "NO_ANSWER")).toBe("No contesta");
    // Lo que no se tocó sigue como estaba.
    expect(labelTipo(config, "EMAIL")).toBe(ACTION_TYPE_LABELS.EMAIL);
  });

  it("apagar un tipo lo saca de lo que el operador puede cargar", () => {
    const config = resolverTipificaciones({ tipos: { VISIT: { activo: false } } });
    expect(tiposCargables(config).map((t) => t.tipo)).not.toContain("VISIT");
    // Pero el tipo sigue existiendo, para poder mostrar el historial viejo.
    expect(labelTipo(config, "VISIT")).toBe(ACTION_TYPE_LABELS.VISIT);
  });

  it("recorta los resultados elegidos a los que el tipo admite", () => {
    // "Ocupado" no existe para un email. Si quedó guardado de una versión vieja,
    // no se puede volver a ofrecer.
    const config = resolverTipificaciones({
      tipos: { EMAIL: { resultados: ["BUSY", "PAID", "NO_ANSWER"] } },
    });

    const resultados = resultadosDe(config, "EMAIL");
    expect(resultados).not.toContain("BUSY");
    expect(resultados.sort()).toEqual(["NO_ANSWER", "PAID"]);
  });

  it("un tipo sin ningún resultado válido queda apagado", () => {
    // Dejarlo activo pondría en el selector una opción con la que el operador no
    // puede cerrar la gestión.
    const config = resolverTipificaciones({ tipos: { CALL: { resultados: [] } } });
    expect(tiposCargables(config).map((t) => t.tipo)).not.toContain("CALL");
  });

  it("una gestión vieja de un tipo apagado se sigue mostrando con su nombre", () => {
    // Esconder el historial sería peor que mostrarlo: la gestión existió.
    const config = resolverTipificaciones({ tipos: { SMS: { activo: false } } });
    expect(labelTipo(config, "SMS")).toBe(ACTION_TYPE_LABELS.SMS);
  });

  it("un tipo o resultado desconocido se muestra crudo en vez de romper", () => {
    const config = resolverTipificaciones(undefined);
    expect(labelTipo(config, "TELEPATIA")).toBe("TELEPATIA");
    expect(labelResultado(config, "VAYA_A_SABER")).toBe("VAYA_A_SABER");
  });
});

describe("campos propios: donde se ven", () => {
  const leer = (campos: unknown) =>
    resolverSettings({ camposPropios: campos }).camposPropios;

  /**
   * Los campos definidos antes de que existiera la opcion se veian todos.
   * Apagarlos de golpe seria sacarle datos de la pantalla a alguien que no
   * pidio nada.
   */
  it("un campo sin el dato guardado se muestra", () => {
    expect(leer([{ id: "sucursal", label: "Sucursal", tipo: "texto" }])).toEqual([
      { id: "sucursal", label: "Sucursal", tipo: "texto", enFicha: true },
    ]);
  });

  it("respeta el campo apagado", () => {
    const campos = leer([
      { id: "nro_rec", label: "Nro. de recibo", tipo: "texto", enFicha: false },
    ]);

    expect(campos[0].enFicha).toBe(false);
  });

  it("sigue descartando los ids repetidos", () => {
    const campos = leer([
      { id: "sucursal", label: "Sucursal", tipo: "texto" },
      { id: "sucursal", label: "Otra", tipo: "texto", enFicha: false },
    ]);

    expect(campos).toHaveLength(1);
    expect(campos[0].label).toBe("Sucursal");
  });
});
