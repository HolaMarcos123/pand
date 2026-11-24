import { describe, expect, it } from "vitest";

import type { ActionResult, ActionType } from "@/generated/prisma/enums";
import {
  SETTINGS_POR_DEFECTO,
  baseDeResultado,
  baseDeTipo,
  labelResultado,
  labelTipo,
  resolverSettings,
  resolverTipificaciones,
  resultadosConfigDe,
  resultadosDe,
  slugDeTipificacion,
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

/**
 * Tipificaciones propias: el nombre lo escribe la organización, el significado lo
 * hereda de una de fábrica.
 *
 * Es lo que permite que una financiera llame "Acordó refinanciar" a una promesa
 * sin que el reporte de cumplimiento de promesas deje de contarla. Todo lo que
 * sigue protege esa propiedad: si se puede crear una tipificación sin significado,
 * o cuyo significado no corresponde al canal, los reportes se quedan sin forma de
 * clasificar y es exactamente el problema que esto vino a evitar.
 */
describe("tipificaciones propias", () => {
  const conPropias = () =>
    resolverTipificaciones({
      resultadosPropios: [
        { id: "acordo_refinanciar", label: "Acordó refinanciar", base: "PROMISE_PAY" },
        { id: "atendio_el_hijo", label: "Atendió el hijo", base: "CALLBACK" },
      ],
      tiposPropios: [
        { id: "carta_documento", label: "Carta documento", base: "EMAIL" },
      ],
    });

  it("un resultado propio entra al catálogo con su nombre y su significado", () => {
    const config = conPropias();

    expect(labelResultado(config, "acordo_refinanciar")).toBe("Acordó refinanciar");
    expect(baseDeResultado(config, "acordo_refinanciar")).toBe("PROMISE_PAY");
  });

  it("un tipo propio es cargable y hereda el canal", () => {
    const config = conPropias();

    expect(tiposCargables(config).map((t) => t.tipo)).toContain("carta_documento");
    expect(labelTipo(config, "carta_documento")).toBe("Carta documento");
    expect(baseDeTipo(config, "carta_documento")).toBe("EMAIL");
  });

  it("un resultado propio se ofrece solo donde su significado tiene sentido", () => {
    const config = conPropias();

    // "Atendió el hijo" hereda de CALLBACK, que una llamada admite y un SMS no.
    expect(resultadosDe(config, "CALL")).toContain("atendio_el_hijo");
    expect(resultadosDe(config, "SMS")).not.toContain("atendio_el_hijo");
  });

  it("el tipo propio ofrece lo mismo que el canal del que hereda", () => {
    const config = conPropias();

    // Carta documento hereda de EMAIL: no puede ofrecer "ocupado", igual que un
    // email. Si no, el reporte de efectividad por canal se ensucia.
    expect(resultadosDe(config, "carta_documento")).toEqual(
      resultadosDe(config, "EMAIL"),
    );
    expect(resultadosDe(config, "carta_documento")).not.toContain("BUSY");
  });

  it("un tipo propio puede ofrecer un subconjunto", () => {
    const config = resolverTipificaciones({
      tiposPropios: [
        {
          id: "visita_laboral",
          label: "Visita laboral",
          base: "VISIT",
          resultados: ["NO_ANSWER", "PAID", "BUSY"],
        },
      ],
    });

    // BUSY no lo admite una visita, así que se descarta aunque esté guardado.
    expect(resultadosDe(config, "visita_laboral").sort()).toEqual([
      "NO_ANSWER",
      "PAID",
    ]);
  });

  it("los ids repetidos se descartan en vez de taparse entre ellos", () => {
    const config = resolverTipificaciones({
      resultadosPropios: [
        { id: "cerrado", label: "Local cerrado", base: "NO_ANSWER" },
        { id: "cerrado", label: "Otra cosa", base: "PAID" },
      ],
      tiposPropios: [
        { id: "carta", label: "Carta", base: "EMAIL" },
        { id: "carta", label: "Otra carta", base: "SMS" },
      ],
    });

    expect(config.resultados.filter((r) => r.codigo === "cerrado")).toHaveLength(1);
    expect(labelResultado(config, "cerrado")).toBe("Local cerrado");
    expect(config.tipos.filter((t) => t.tipo === "carta")).toHaveLength(1);
    expect(labelTipo(config, "carta")).toBe("Carta");
  });

  it("una propia no puede pisar a una de fábrica", () => {
    // El slug es siempre minúscula y el enum siempre mayúscula, así que no hay
    // forma de colisionar. Esto lo fija como garantía, no como casualidad.
    expect(slugDeTipificacion("CALL")).toBe("call");
    expect(slugDeTipificacion("Promete pagar")).toBe("promete_pagar");
    expect(slugDeTipificacion("3er intento")).toBe("t_3er_intento");

    const config = resolverTipificaciones({
      resultadosPropios: [{ id: "paid", label: "Pagó en caja", base: "PAID" }],
    });

    expect(labelResultado(config, "PAID")).toBe(ACTION_RESULT_LABELS.PAID);
    expect(labelResultado(config, "paid")).toBe("Pagó en caja");
  });

  it("una base inventada tira toda la tipificación, no la configuración", () => {
    const config = resolverTipificaciones({
      resultadosPropios: [
        // Una base que no existe. Es lo que podría quedar en el JSON si una
        // versión futura del producto agrega un resultado y después se vuelve
        // atrás, y no puede dejar la configuración sin leer.
        { id: "telepatia", label: "Telepatía", base: "NO_EXISTE" },
      ],
      etiquetasResultado: { PAID: "Cobrado" },
    });

    expect(resultadosDe(config, "CALL")).not.toContain("telepatia");
    // Y lo que sí era válido en el mismo objeto se conserva.
    expect(labelResultado(config, "PAID")).toBe("Cobrado");
  });

  it("un resultado borrado se sigue leyendo con el nombre que tenía", () => {
    // La gestión de hace tres meses apunta a "acordo_refinanciar" y la
    // organización borró esa tipificación. Mostrar el slug crudo sería ilegible.
    const config = resolverTipificaciones(undefined);
    expect(labelResultado(config, "acordo_refinanciar")).toBe("Acordo refinanciar");
    expect(labelTipo(config, "carta_documento")).toBe("Carta documento");
  });

  it("una tipificación corrupta no se lleva puesta a toda la configuración", () => {
    // El caso que importa: el parseo entra por resolverSettings, que valida la
    // columna entera. Una fila rota tiene que costar esa fila y nada más.
    const settings = resolverSettings({
      currency: "USD",
      tipificaciones: {
        resultadosPropios: [
          { id: "sirve", label: "Local cerrado", base: "NO_ANSWER" },
          { nada: "que ver" },
          { id: "MAYUSCULAS", label: "Mal id", base: "PAID" },
        ],
      },
    });

    expect(settings.currency).toBe("USD");
    expect(labelResultado(settings.tipificaciones, "sirve")).toBe("Local cerrado");
    expect(settings.tipificaciones.resultados.filter((r) => r.propia)).toHaveLength(1);
  });

  it("resultadosConfigDe trae lo que necesita un selector", () => {
    const config = conPropias();
    const opciones = resultadosConfigDe(config, "CALL");

    expect(opciones.every((o) => o.label.length > 0)).toBe(true);
    // Las de fábrica primero: son las que el operador ya conoce.
    expect(opciones[0].propia).toBe(false);
    expect(opciones.at(-1)?.propia).toBe(true);
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
