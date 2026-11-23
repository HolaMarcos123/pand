"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Sector } from "@/generated/prisma/enums";
import { requireSession } from "@/lib/auth/session";
import {
  MAX_CAMPOS_PROPIOS,
  MONEDAS,
  TIPOS_DE_CAMPO,
  ZONAS_HORARIAS,
  idDeCampo,
  resolverSettings,
  settingsGuardadosSchema,
  type CampoPropio,
  type SettingsGuardados,
  type TipoDeCampo,
} from "@/lib/config/settings";
import { prisma } from "@/lib/prisma";

export type ConfigResult = { ok: true } | { ok: false; error: string };

const SECTORES = ["FINANCIAL", "B2B", "TELECOM", "RETAIL"] as const satisfies readonly Sector[];

/**
 * Guarda cambios en `organizations.settings` sin pisar lo que no se tocó.
 *
 * La columna la comparten varias cosas —las preferencias de esta pantalla y el
 * `columnMappings` que escribe el importador cuando aprende un mapeo—. Escribir el
 * objeto entero haría que guardar la moneda borre los mapeos aprendidos, y eso no
 * se nota hasta la próxima importación.
 */
async function mergeSettings(
  organizationId: string,
  cambios: SettingsGuardados,
): Promise<void> {
  const actual = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { settings: true },
  });

  const base =
    actual.settings && typeof actual.settings === "object" && !Array.isArray(actual.settings)
      ? (actual.settings as Record<string, unknown>)
      : {};

  await prisma.organization.update({
    where: { id: organizationId },
    data: { settings: { ...base, ...cambios } },
  });
}

/** Solo el administrador configura la organización. */
async function requireAdmin() {
  const session = await requireSession();
  if (session.user.role !== "ADMIN") return null;
  return session;
}

// ───────────────────────── Organización ─────────────────────────

const organizacionSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sector: z.enum(SECTORES),
  currency: z.enum(MONEDAS.map((m) => m.value) as [string, ...string[]]),
  timezone: z.enum(ZONAS_HORARIAS),
});

export async function saveOrganizacion(
  input: z.infer<typeof organizacionSchema>,
): Promise<ConfigResult> {
  const session = await requireAdmin();
  if (!session) {
    return { ok: false, error: "Solo un administrador puede cambiar la configuración." };
  }

  const parsed = organizacionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { name, sector, currency, timezone } = parsed.data;
  const organizationId = session.organization.id;

  // El slug no se toca: es parte de la identidad de la organización y cambiarlo
  // rompería cualquier enlace que alguien haya guardado.
  await prisma.organization.update({
    where: { id: organizationId },
    data: { name, sector },
  });
  await mergeSettings(organizationId, { currency, timezone });

  // La moneda y el nombre se leen en el layout, así que se revalida todo.
  revalidatePath("/", "layout");

  return { ok: true };
}

// ───────────────────────── Tipificaciones ─────────────────────────

const tipificacionesSchema = z.object({
  // Se valida con el mismo esquema que usa la lectura: si lo que se guarda no lo
  // puede volver a leer `resolverSettings`, la pantalla quedaría guardando cosas
  // que después ignora.
  tipificaciones: settingsGuardadosSchema.shape.tipificaciones.unwrap(),
});

export async function saveTipificaciones(
  input: z.infer<typeof tipificacionesSchema>,
): Promise<ConfigResult> {
  const session = await requireAdmin();
  if (!session) {
    return { ok: false, error: "Solo un administrador puede cambiar las tipificaciones." };
  }

  const parsed = tipificacionesSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const activos = Object.values(parsed.data.tipificaciones.tipos ?? {}).filter(
    (t) => t?.activo !== false,
  );
  if (activos.length === 0) {
    return {
      ok: false,
      error: "Dejá al menos un tipo de gestión activo: sin ninguno, el operador no puede registrar nada.",
    };
  }

  await mergeSettings(session.organization.id, {
    tipificaciones: parsed.data.tipificaciones,
  });

  revalidatePath("/tasks");
  revalidatePath("/clients");
  revalidatePath("/admin/settings/tipificaciones");

  return { ok: true };
}

// ───────────────────────── Cobranza ─────────────────────────

const cobranzaSchema = z.object({
  tasaMensual: z.number().min(0).max(100),
  /** Tasa propia por moneda ISO. La que no esta usa la general. */
  porMoneda: z
    .partialRecord(
      z.enum(MONEDAS.map((m) => m.value) as [string, ...string[]]),
      z.number().min(0).max(100),
    )
    .optional(),
});

/**
 * La tasa de interés por mora que usa la ficha del deudor.
 *
 * En cero, el producto deja de mostrar intereses en todas partes. Es el valor
 * por defecto a propósito: mostrar un interés inventado es peor que no mostrar
 * ninguno, porque el operador se lo dice al deudor por teléfono.
 */
export async function saveCobranza(
  input: z.infer<typeof cobranzaSchema>,
): Promise<ConfigResult> {
  const session = await requireAdmin();
  if (!session) {
    return { ok: false, error: "Solo un administrador puede cambiar la configuración." };
  }

  const parsed = cobranzaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "La tasa tiene que ser un porcentaje mensual entre 0 y 100.",
    };
  }

  await mergeSettings(session.organization.id, {
    cobranza: {
      tasaMensual: parsed.data.tasaMensual,
      porMoneda: parsed.data.porMoneda ?? {},
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/clients");
  revalidatePath("/admin/settings/cobranza");

  return { ok: true };
}

const camposPropiosSchema = z.object({
  campos: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        label: z.string().trim().min(1).max(60),
        tipo: z.enum(["texto", "numero", "fecha"]),
      }),
    )
    .max(MAX_CAMPOS_PROPIOS),
});

/**
 * Las columnas propias de la organización, las que Pand no modela.
 *
 * Toda planilla real trae datos que el producto no conoce —la sucursal, el
 * auxiliar de cobranza, el número de factura del sistema de origen— y
 * descartarlos al importar es perder información que la financiera usa todos los
 * días. Acá se declaran, y después aparecen en el mapeo como un campo más.
 *
 * Borrar un campo de esta lista NO borra lo ya importado: el valor sigue en el
 * `metadata` del comprobante y vuelve a verse si el campo se crea de nuevo con
 * el mismo id. Es a propósito: una lista de configuración no debería poder
 * destruir datos de cartera sin avisar.
 */
export async function saveCamposPropios(
  input: z.infer<typeof camposPropiosSchema>,
): Promise<ConfigResult> {
  const session = await requireAdmin();
  if (!session) {
    return { ok: false, error: "Solo un administrador puede cambiar la configuración." };
  }

  const parsed = camposPropiosSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Revisá los nombres: cada campo necesita una etiqueta." };
  }

  const vistos = new Set<string>();
  for (const campo of parsed.data.campos) {
    if (vistos.has(campo.id)) {
      return {
        ok: false,
        error: `Hay dos campos que se llaman igual ("${campo.label}"). Cambiá uno.`,
      };
    }
    vistos.add(campo.id);
  }

  await mergeSettings(session.organization.id, { camposPropios: parsed.data.campos });

  revalidatePath("/admin/settings/campos");
  revalidatePath("/portfolio/new");

  return { ok: true };
}

const campoNuevoSchema = z.object({
  label: z.string().trim().min(1).max(60),
  tipo: z.enum(TIPOS_DE_CAMPO.map((t) => t.value) as [TipoDeCampo, ...TipoDeCampo[]]),
});

export type CampoAgregado =
  | { ok: true; campo: CampoPropio }
  | { ok: false; error: string };

/**
 * Agrega un campo propio sin tocar los que ya están.
 *
 * Va aparte de `saveCamposPropios` —que reemplaza la lista entera y es de
 * administradores— porque quien importa una cartera es muchas veces un
 * supervisor, y frenarlo hasta que aparezca un admin es frenar la carga
 * entera. Agregar es la operación segura: no renombra ni borra, así que no
 * puede esconder datos ya importados ni romper un mapeo guardado.
 *
 * Lee la lista de la base y no de la sesión: dos personas mapeando a la vez
 * tienen que sumar sus campos, no pisarse.
 */
export async function agregarCampoPropio(
  input: z.infer<typeof campoNuevoSchema>,
): Promise<CampoAgregado> {
  const session = await requireSession();
  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "No tenés permiso para crear campos propios." };
  }

  const parsed = campoNuevoSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Ponele un nombre al campo." };
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { settings: true },
  });
  const actuales = resolverSettings(organization.settings).camposPropios;

  const campo: CampoPropio = {
    id: idDeCampo(parsed.data.label),
    label: parsed.data.label,
    tipo: parsed.data.tipo,
    // Un campo que alguien crea desde la pantalla de mapeo lo crea porque lo
    // quiere ver: apagarlo de entrada seria esconderlo apenas se guarda.
    enFicha: true,
  };

  const repetido = actuales.find((c) => c.id === campo.id);
  if (repetido) {
    return {
      ok: false,
      error: `Ya existe un campo propio «${repetido.label}». Elegilo de la lista.`,
    };
  }

  if (actuales.length >= MAX_CAMPOS_PROPIOS) {
    return {
      ok: false,
      error: `Llegaste a los ${MAX_CAMPOS_PROPIOS} campos propios. Borrá alguno en Config → Campos propios.`,
    };
  }

  await mergeSettings(session.organization.id, {
    camposPropios: [...actuales, campo],
  });

  revalidatePath("/admin/settings/campos");
  revalidatePath("/portfolio/new");

  return { ok: true, campo };
}
