"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Sector } from "@/generated/prisma/enums";
import { requireSession } from "@/lib/auth/session";
import {
  MONEDAS,
  ZONAS_HORARIAS,
  settingsGuardadosSchema,
  type SettingsGuardados,
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
    cobranza: { tasaMensual: parsed.data.tasaMensual },
  });

  revalidatePath("/tasks");
  revalidatePath("/clients");
  revalidatePath("/admin/settings/cobranza");

  return { ok: true };
}
