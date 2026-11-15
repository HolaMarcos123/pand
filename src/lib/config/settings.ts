import { z } from "zod";

import type { ActionResult, ActionType } from "@/generated/prisma/enums";
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
 * Por qué las tipificaciones se configuran pero no se inventan.
 *
 * El pedido era poder personalizar "resultado de gestión" y "tipo de llamadas".
 * Lo que se puede personalizar es **cuáles usa cada organización, cómo las llama y
 * qué resultados ofrece cada tipo**. Lo que no se puede es inventar resultados
 * nuevos de texto libre, y conviene decir por qué:
 *
 * el producto necesita saber cuál de esos resultados significa "prometió pagar"
 * para armar el reporte de cumplimiento de promesas, y cuáles significan "no había
 * nadie" para medir contactabilidad. Con texto libre, los dos reportes se quedan
 * sin forma de clasificar y dejan de existir.
 *
 * O sea: se configura el vocabulario, no la semántica.
 */

const TODOS_LOS_TIPOS = Object.keys(ACTION_TYPE_LABELS) as ActionType[];
const TODOS_LOS_RESULTADOS = Object.keys(ACTION_RESULT_LABELS) as ActionResult[];

export type TipoConfig = {
  tipo: ActionType;
  label: string;
  activo: boolean;
  /** Resultados que se ofrecen al cargar una gestión de este tipo. */
  resultados: ActionResult[];
  /** Si lo puede cargar una persona. AI_CALL y PROMISE los crea el sistema. */
  manual: boolean;
};

export type Tipificaciones = {
  tipos: TipoConfig[];
  etiquetasResultado: Record<ActionResult, string>;
};

const tipoGuardadoSchema = z.object({
  label: z.string().trim().min(1).max(40).optional(),
  activo: z.boolean().optional(),
  resultados: z.array(z.enum(TODOS_LOS_RESULTADOS as [string, ...string[]])).optional(),
});

const tipificacionesGuardadasSchema = z.object({
  tipos: z.partialRecord(
    z.enum(TODOS_LOS_TIPOS as [string, ...string[]]),
    tipoGuardadoSchema,
  ).optional(),
  etiquetasResultado: z.partialRecord(
    z.enum(TODOS_LOS_RESULTADOS as [string, ...string[]]),
    z.string().trim().min(1).max(40),
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

export const settingsGuardadosSchema = z.object({
  currency: z.enum(MONEDAS.map((m) => m.value) as [string, ...string[]]).optional(),
  timezone: z.enum(ZONAS_HORARIAS).optional(),
  tipificaciones: tipificacionesGuardadasSchema.optional(),
});

export type SettingsGuardados = z.infer<typeof settingsGuardadosSchema>;

export type Settings = {
  currency: string;
  timezone: string;
  tipificaciones: Tipificaciones;
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
  };
}

export function resolverTipificaciones(
  guardadas: TipificacionesGuardadas | undefined,
): Tipificaciones {
  const tipos = TODOS_LOS_TIPOS.map((tipo): TipoConfig => {
    const guardado = guardadas?.tipos?.[tipo];
    const permitidos = RESULTS_BY_TYPE[tipo];

    // Los resultados guardados se filtran contra los que el tipo admite: si alguien
    // configuró "ocupado" para un email y después se corrigió el catálogo, no se
    // arrastra una opción que no tiene sentido.
    const resultados = guardado?.resultados
      ? permitidos.filter((r) => guardado.resultados!.includes(r))
      : permitidos;

    return {
      tipo,
      label: guardado?.label ?? ACTION_TYPE_LABELS[tipo],
      // Un tipo sin ningún resultado válido quedaría inusable: se trata como apagado.
      activo: (guardado?.activo ?? true) && (resultados.length > 0 || tipo === "NOTE"),
      resultados,
      manual: MANUAL_ACTION_TYPES.includes(tipo),
    };
  });

  const etiquetasResultado = Object.fromEntries(
    TODOS_LOS_RESULTADOS.map((r) => [
      r,
      guardadas?.etiquetasResultado?.[r] ?? ACTION_RESULT_LABELS[r],
    ]),
  ) as Record<ActionResult, string>;

  return { tipos, etiquetasResultado };
}

// ───────────────────────── Ayudantes de lectura ─────────────────────────

/** Los tipos que un operador puede elegir al cargar una gestión. */
export function tiposCargables(config: Tipificaciones): TipoConfig[] {
  return config.tipos.filter((t) => t.manual && t.activo);
}

/** Resultados ofrecidos para un tipo. Vacío para las notas, que no llevan. */
export function resultadosDe(
  config: Tipificaciones,
  tipo: ActionType,
): ActionResult[] {
  return config.tipos.find((t) => t.tipo === tipo)?.resultados ?? [];
}

/**
 * Etiqueta de un tipo de gestión.
 *
 * Acepta un string porque el historial trae el valor crudo de la base, que puede
 * ser un tipo que la organización apagó después. Un dato viejo se sigue mostrando
 * con su nombre: esconderlo sería peor que mostrarlo.
 */
export function labelTipo(config: Tipificaciones, tipo: string): string {
  return config.tipos.find((t) => t.tipo === tipo)?.label ?? tipo;
}

export function labelResultado(config: Tipificaciones, resultado: string): string {
  return config.etiquetasResultado[resultado as ActionResult] ?? resultado;
}
