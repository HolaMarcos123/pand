import { z } from "zod";

import type { ActionResult, ActionType } from "@/generated/prisma/enums";
import {
  INTERES_POR_DEFECTO,
  type ConfigInteres,
} from "@/lib/collections/intereses";
import {
  ACTION_RESULT_LABELS,
  ACTION_TYPE_LABELS,
  MANUAL_ACTION_TYPES,
  RESULTS_BY_TYPE,
} from "@/lib/tasks/action-config";

/**
 * La configuración de una organización.
 *
 * Vive en la columna `organizations.settings`, que es JSON. Eso no es pereza: lo
 * que hay acá son preferencias de presentación y parámetros de negocio que nadie
 * consulta ni cruza en SQL. Darle una tabla a cada una significaría una migración
 * por preferencia nueva, y la primera consecuencia sería que nadie agrega ninguna.
 *
 * Lo que **sí** necesita tabla es todo lo que se filtra, se agrupa o se audita. Por
 * eso los segmentos son una tabla y los nombres de las tipificaciones no.
 *
 * Como el JSON no garantiza nada, todo se lee con `resolverSettings`, que mezcla lo
 * guardado sobre los valores por defecto. Una clave que falta no es un error: es un
 * valor por defecto. Y una clave que sobra —`columnMappings`, que escribe el
 * importador— se conserva al guardar.
 */

// ───────────────────────── Tipificaciones ─────────────────────────

/**
 * Tipificaciones: el nombre se elige, el significado se hereda.
 *
 * El pedido original era poder personalizar "resultado de gestión" y "tipo de
 * llamada", y la primera versión dejaba renombrar y apagar las de fábrica pero no
 * crear ninguna. La razón era buena: el producto necesita saber cuál de los
 * resultados significa "prometió pagar" para armar el reporte de cumplimiento de
 * promesas, y cuáles significan "no había nadie" para medir contactabilidad. Con
 * texto libre, los dos reportes se quedan sin forma de clasificar.
 *
 * Pero no hacía falta elegir entre las dos cosas. Una tipificación propia declara
 * de cuál de fábrica **hereda el significado**, y entonces se puede tener las dos:
 *
 *     "Carta documento"  → hereda de EMAIL
 *     "Llamó el hijo"    → hereda de CALLBACK
 *     "Acordó refinanciar" → hereda de PROMISE_PAY
 *
 * La gestión guarda el enum heredado en `action_type` / `result` —de ahí salen los
 * reportes, sin tocarlos— y además el slug de la tipificación elegida en
 * `type_code` / `result_code`. El reporte de efectividad por canal cuenta la carta
 * documento como email, que es lo correcto, y la ficha del deudor muestra "Carta
 * documento", que es lo que cargó el operador.
 *
 * O sea: se configura el vocabulario, no la semántica. Pero el vocabulario ahora
 * se puede escribir, no solo elegir.
 */

const TODOS_LOS_TIPOS = Object.keys(ACTION_TYPE_LABELS) as ActionType[];
const TODOS_LOS_RESULTADOS = Object.keys(ACTION_RESULT_LABELS) as ActionResult[];

/**
 * Topes por organización.
 *
 * No son limitaciones técnicas: un selector de treinta resultados no lo usa
 * nadie —el operador elige el primero que más o menos encaja— y el reporte por
 * resultado deja de caber en una pantalla.
 */
export const MAX_TIPOS_PROPIOS = 10;
export const MAX_RESULTADOS_PROPIOS = 20;

/**
 * El código de una tipificación.
 *
 * Las de fábrica usan el nombre del enum (`CALL`, `PROMISE_PAY`) y las propias un
 * slug en minúsculas (`carta_documento`). Que unas sean mayúsculas y otras
 * minúsculas no es cosmético: hace imposible que una propia pise a una de
 * fábrica, sin necesidad de prefijos ni de una lista de nombres reservados.
 */
const slugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

/** Convierte un nombre escrito por una persona en un código estable. */
export function slugDeTipificacion(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  // Tiene que empezar con letra: "3er intento" no sirve como código.
  return /^[a-z]/.test(base) ? base : `t_${base}`.slice(0, 40);
}

export type TipoConfig = {
  /** `CALL` si es de fábrica, `carta_documento` si la creó la organización. */
  tipo: string;
  /** El tipo de fábrica del que hereda el significado. */
  base: ActionType;
  label: string;
  activo: boolean;
  /** Códigos de resultado que se ofrecen al cargar una gestión de este tipo. */
  resultados: string[];
  /** Si lo puede cargar una persona. AI_CALL y PROMISE los crea el sistema. */
  manual: boolean;
  /** La creó la organización: se puede borrar. Las de fábrica solo se apagan. */
  propia: boolean;
};

export type ResultadoConfig = {
  codigo: string;
  base: ActionResult;
  label: string;
  propia: boolean;
};

export type Tipificaciones = {
  tipos: TipoConfig[];
  /** El catálogo completo de resultados: los de fábrica y los propios. */
  resultados: ResultadoConfig[];
};

const etiquetaSchema = z.string().trim().min(1).max(40);

const tipoGuardadoSchema = z.object({
  label: etiquetaSchema.optional(),
  activo: z.boolean().optional(),
  // Códigos, no el enum: desde que hay resultados propios acá puede venir un slug.
  // Lo que no exista o no corresponda al tipo se descarta al resolver.
  resultados: z.array(z.string().trim().min(1).max(40)).max(60).optional(),
});

const tipoPropioSchema = z.object({
  id: slugSchema,
  label: etiquetaSchema,
  // Solo de un tipo que carga una persona. Heredar de AI_CALL o de PROMISE
  // dejaría al operador cargando a mano algo que el producto genera solo.
  base: z.enum(MANUAL_ACTION_TYPES as [ActionType, ...ActionType[]]),
  activo: z.boolean().optional(),
  resultados: z.array(z.string().trim().min(1).max(40)).max(60).optional(),
});

const resultadoPropioSchema = z.object({
  id: slugSchema,
  label: etiquetaSchema,
  base: z.enum(TODOS_LOS_RESULTADOS as [string, ...string[]]),
});

/**
 * Un array que descarta los elementos que no entiende, en vez de invalidarse entero.
 *
 * Sin esto, UNA tipificación propia corrupta en el JSON —de una versión anterior,
 * de una escritura a medias— hacía fallar el parseo de toda la columna `settings`,
 * y la organización perdía de golpe la moneda, la zona horaria y los campos
 * propios. Un elemento roto solo puede costar ese elemento.
 */
function arrayTolerante<T>(item: z.ZodType<T>, max: number) {
  return z.array(z.unknown()).transform((filas): T[] => {
    const validas: T[] = [];
    for (const fila of filas) {
      if (validas.length === max) break;
      const parsed = item.safeParse(fila);
      if (parsed.success) validas.push(parsed.data);
    }
    return validas;
  });
}

const tipificacionesGuardadasSchema = z.object({
  tipos: z.partialRecord(
    z.enum(TODOS_LOS_TIPOS as [string, ...string[]]),
    tipoGuardadoSchema,
  ).optional(),
  etiquetasResultado: z.partialRecord(
    z.enum(TODOS_LOS_RESULTADOS as [string, ...string[]]),
    etiquetaSchema,
  ).optional(),
  tiposPropios: arrayTolerante(tipoPropioSchema, MAX_TIPOS_PROPIOS).optional(),
  resultadosPropios: arrayTolerante(
    resultadoPropioSchema,
    MAX_RESULTADOS_PROPIOS,
  ).optional(),
});

export type TipificacionesGuardadas = z.infer<typeof tipificacionesGuardadasSchema>;

// ───────────────────────── Settings completos ─────────────────────────

export const MONEDAS = [
  { value: "PYG", label: "Guaraní (Gs.)" },
  { value: "USD", label: "Dólar (US$)" },
  { value: "ARS", label: "Peso argentino ($)" },
  { value: "BRL", label: "Real (R$)" },
] as const;

export const ZONAS_HORARIAS = [
  "America/Asuncion",
  "America/Argentina/Buenos_Aires",
  "America/Sao_Paulo",
  "America/Montevideo",
  "America/Santiago",
  "America/La_Paz",
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "UTC",
] as const;

export type ZonaHoraria = (typeof ZONAS_HORARIAS)[number];

/**
 * Un campo propio de la organizacion.
 *
 * Toda planilla real trae columnas que Pand no conoce —la sucursal, el auxiliar
 * de cobranza, el numero de factura del sistema de origen— y descartarlas al
 * importar es perder datos que la financiera usa todos los dias. En vez de
 * adivinar que columnas podrian existir, cada organizacion declara las suyas.
 *
 * El `id` es estable y el `label` se puede cambiar: si alguien renombra
 * "Sucursal" a "Agencia", lo ya importado sigue encontrandose.
 */
export const TIPOS_DE_CAMPO = [
  { value: "texto", label: "Texto" },
  { value: "numero", label: "Numero" },
  { value: "fecha", label: "Fecha" },
] as const;

export type TipoDeCampo = (typeof TIPOS_DE_CAMPO)[number]["value"];

export type CampoPropio = {
  id: string;
  label: string;
  tipo: TipoDeCampo;
  /**
   * Si se muestra en el panel de gestion.
   *
   * Una planilla real trae 44 columnas y la organizacion importa las que le
   * sirven, pero no todas le sirven al operador que esta llamando: el numero de
   * recibo o la referencia de transferencia son para conciliar, no para la
   * llamada. Se siguen guardando y exportando; lo que se elige es que ve quien
   * atiende el telefono.
   *
   * Por defecto `true`: un campo que alguien se tomo el trabajo de importar se
   * muestra salvo que diga lo contrario.
   */
  enFicha: boolean;
};

/** Tope por organizacion. No es una limitacion tecnica: es para que la pantalla
 *  de mapeo siga siendo legible. */
export const MAX_CAMPOS_PROPIOS = 20;

const campoPropioSchema = z.object({
  // Minusculas, numeros y guion bajo: se usa como clave dentro del JSON del
  // comprobante, asi que tiene que ser estable y facil de consultar en SQL.
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_DE_CAMPO.map((t) => t.value) as [TipoDeCampo, ...TipoDeCampo[]]),
  enFicha: z.boolean().optional(),
});

/** Convierte una etiqueta escrita por una persona en un id estable. */
export function idDeCampo(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

  // Tiene que empezar con letra: "3ra_visita" no sirve como clave.
  return /^[a-z]/.test(base) ? base : `campo_${base}`.slice(0, 40);
}

export const settingsGuardadosSchema = z.object({
  currency: z.enum(MONEDAS.map((m) => m.value) as [string, ...string[]]).optional(),
  timezone: z.enum(ZONAS_HORARIAS).optional(),
  tipificaciones: tipificacionesGuardadasSchema.optional(),
  camposPropios: z.array(campoPropioSchema).max(MAX_CAMPOS_PROPIOS).optional(),
  cobranza: z
    .object({
      // Tasa mensual en porcentaje. El tope existe para atajar el dedo gordo:
      // escribir 450 donde iba 4,50 convierte la ficha de un deudor en ciencia
      // ficción y nadie lo nota hasta que un cliente lo reclama.
      tasaMensual: z.number().min(0).max(100).optional(),
      // Tasa por moneda ISO. La clave se valida con el mismo catalogo que el
      // resto del producto: una moneda inventada no tiene donde mostrarse.
      porMoneda: z
        .partialRecord(
          z.enum(MONEDAS.map((m) => m.value) as [string, ...string[]]),
          z.number().min(0).max(100),
        )
        .optional(),
    })
    .optional(),
});

export type SettingsGuardados = z.infer<typeof settingsGuardadosSchema>;

export type Settings = {
  currency: string;
  timezone: string;
  tipificaciones: Tipificaciones;
  /** Columnas propias de la organizacion, para lo que Pand no modela. */
  camposPropios: CampoPropio[];
  /** Parámetros de cobranza. Hoy solo el interés por mora. */
  cobranza: ConfigInteres;
};

export const SETTINGS_POR_DEFECTO = {
  currency: "PYG",
  timezone: "America/Asuncion",
} as const;

/**
 * Lee la columna `settings` y devuelve una configuración completa.
 *
 * Nunca falla: lo que no se entiende se descarta y queda el valor por defecto. Un
 * JSON corrupto no puede dejar la aplicación sin poder abrir una pantalla.
 */
export function resolverSettings(raw: unknown): Settings {
  const parsed = settingsGuardadosSchema.safeParse(raw ?? {});
  const guardado: SettingsGuardados = parsed.success ? parsed.data : {};

  return {
    currency: guardado.currency ?? SETTINGS_POR_DEFECTO.currency,
    timezone: guardado.timezone ?? SETTINGS_POR_DEFECTO.timezone,
    tipificaciones: resolverTipificaciones(guardado.tipificaciones),
    // Se descartan los ids repetidos: dos campos con el mismo id escribirian
    // sobre la misma clave y uno pisaria al otro sin aviso.
    camposPropios: (guardado.camposPropios ?? [])
      .filter((campo, i, todos) => todos.findIndex((c) => c.id === campo.id) === i)
      // Sin el dato guardado, se muestra: los campos definidos antes de que
      // existiera esta opcion se veian todos, y apagarlos de golpe seria
      // sacarle datos de la pantalla a alguien que no pidio nada.
      .map((campo) => ({ ...campo, enFicha: campo.enFicha ?? true })),
    cobranza: {
      tasaMensual:
        guardado.cobranza?.tasaMensual ?? INTERES_POR_DEFECTO.tasaMensual,
      // Sin tasa propia, la moneda usa la general. Guardar la general como
      // tasa de cada moneda seria peor: cambiarla despues no se propagaria.
      porMoneda: Object.fromEntries(
        Object.entries(guardado.cobranza?.porMoneda ?? {}).filter(
          ([, tasa]) => typeof tasa === "number",
        ),
      ) as Record<string, number>,
    },
  };
}

export function resolverTipificaciones(
  guardadas: TipificacionesGuardadas | undefined,
): Tipificaciones {
  // ── El catálogo de resultados ────────────────────────────────────────
  // Primero los de fábrica, en su orden canónico, y después los propios. El
  // orden es el que ve el operador en el selector, así que los que ya conoce van
  // antes que los que agregó su organización.
  const deFabrica: ResultadoConfig[] = TODOS_LOS_RESULTADOS.map((r) => ({
    codigo: r,
    base: r,
    label: guardadas?.etiquetasResultado?.[r] ?? ACTION_RESULT_LABELS[r],
    propia: false,
  }));

  const propios: ResultadoConfig[] = (guardadas?.resultadosPropios ?? [])
    // Un id repetido escribiría dos veces el mismo código y uno taparía al otro
    // en el selector sin aviso.
    .filter((r, i, todos) => todos.findIndex((otro) => otro.id === r.id) === i)
    .map((r) => ({
      codigo: r.id,
      base: r.base as ActionResult,
      label: r.label,
      propia: true,
    }));

  const resultados = [...deFabrica, ...propios];

  /**
   * Los resultados que un tipo admite: los de fábrica que ya admitía, más los
   * propios que heredan de uno de ellos.
   *
   * Es lo que mantiene la regla de que "ocupado" no existe para un email: un
   * resultado propio que hereda de BUSY tampoco se ofrece ahí.
   */
  const admitidosPor = (base: ActionType): string[] => {
    const permitidos = RESULTS_BY_TYPE[base];
    return resultados
      .filter((r) => permitidos.includes(r.base))
      .map((r) => r.codigo);
  };

  /** Lo guardado se recorta contra lo admitido; sin nada guardado, va todo. */
  const elegidos = (admitidos: string[], guardado: string[] | undefined) =>
    guardado ? admitidos.filter((codigo) => guardado.includes(codigo)) : admitidos;

  // ── Los tipos de fábrica ─────────────────────────────────────────────
  const tiposDeFabrica = TODOS_LOS_TIPOS.map((tipo): TipoConfig => {
    const guardado = guardadas?.tipos?.[tipo];
    const suyos = elegidos(admitidosPor(tipo), guardado?.resultados);

    return {
      tipo,
      base: tipo,
      label: guardado?.label ?? ACTION_TYPE_LABELS[tipo],
      // Un tipo sin ningún resultado válido quedaría inusable: se trata como apagado.
      activo: (guardado?.activo ?? true) && (suyos.length > 0 || tipo === "NOTE"),
      resultados: suyos,
      manual: MANUAL_ACTION_TYPES.includes(tipo),
      propia: false,
    };
  });

  // ── Los tipos que creó la organización ───────────────────────────────
  const tiposPropios = (guardadas?.tiposPropios ?? [])
    .filter((t, i, todos) => todos.findIndex((otro) => otro.id === t.id) === i)
    .map((t): TipoConfig => {
      const base = t.base as ActionType;
      const suyos = elegidos(admitidosPor(base), t.resultados);

      return {
        tipo: t.id,
        base,
        label: t.label,
        activo: (t.activo ?? true) && (suyos.length > 0 || base === "NOTE"),
        resultados: suyos,
        // Siempre manual: la base ya está restringida a los tipos que carga una
        // persona, así que no hay forma de crear una propia que genere el sistema.
        manual: true,
        propia: true,
      };
    });

  return { tipos: [...tiposDeFabrica, ...tiposPropios], resultados };
}

// ───────────────────────── Ayudantes de lectura ─────────────────────────

/**
 * Nombre de una tipificación que ya no está en la configuración.
 *
 * Pasa con el historial: una gestión de hace tres meses puede apuntar a una
 * tipificación propia que después se borró. Esconderla sería peor que mostrarla,
 * así que se muestra con el mejor nombre disponible.
 *
 * Un código en mayúsculas es un enum —de una versión del producto más nueva o más
 * vieja que esta configuración— y se muestra crudo: inventarle un nombre bonito a
 * algo que no entendemos engaña. Un slug en minúsculas, en cambio, salió del
 * nombre que la organización le había puesto, así que se puede reconstruir:
 * `carta_documento` vuelve a leerse "Carta documento".
 */
function nombreCrudo(codigo: string): string {
  if (/^[A-Z][A-Z0-9_]*$/.test(codigo)) return codigo;

  const texto = codigo.replace(/_/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function tipoDe(config: Tipificaciones, codigo: string): TipoConfig | undefined {
  return config.tipos.find((t) => t.tipo === codigo);
}

export function resultadoDe(
  config: Tipificaciones,
  codigo: string,
): ResultadoConfig | undefined {
  return config.resultados.find((r) => r.codigo === codigo);
}

/** Los tipos que un operador puede elegir al cargar una gestión. */
export function tiposCargables(config: Tipificaciones): TipoConfig[] {
  return config.tipos.filter((t) => t.manual && t.activo);
}

/** Códigos de resultado ofrecidos para un tipo. Vacío para las notas, que no llevan. */
export function resultadosDe(config: Tipificaciones, tipo: string): string[] {
  return tipoDe(config, tipo)?.resultados ?? [];
}

/** Lo mismo, ya resuelto a nombre y significado: es lo que necesita un selector. */
export function resultadosConfigDe(
  config: Tipificaciones,
  tipo: string,
): ResultadoConfig[] {
  return resultadosDe(config, tipo)
    .map((codigo) => resultadoDe(config, codigo))
    .filter((r): r is ResultadoConfig => r !== undefined);
}

/**
 * El tipo de fábrica del que hereda un código. `null` si no se reconoce.
 *
 * Es lo que se guarda en la columna `action_type`, y por lo tanto lo que ven
 * todos los reportes.
 */
export function baseDeTipo(config: Tipificaciones, codigo: string): ActionType | null {
  return tipoDe(config, codigo)?.base ?? null;
}

export function baseDeResultado(
  config: Tipificaciones,
  codigo: string,
): ActionResult | null {
  return resultadoDe(config, codigo)?.base ?? null;
}

/**
 * Etiqueta de un tipo de gestión.
 *
 * Acepta un string porque el historial trae el valor crudo de la base, que puede
 * ser un tipo que la organización apagó o borró después. Un dato viejo se sigue
 * mostrando con su nombre: esconderlo sería peor que mostrarlo.
 */
export function labelTipo(config: Tipificaciones, tipo: string): string {
  return tipoDe(config, tipo)?.label ?? nombreCrudo(tipo);
}

export function labelResultado(config: Tipificaciones, resultado: string): string {
  return resultadoDe(config, resultado)?.label ?? nombreCrudo(resultado);
}
