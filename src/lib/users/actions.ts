"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { idSchema } from "@/lib/validation/id";

/**
 * Administración del equipo de una organización.
 *
 * La distinción que ordena todo este archivo es entre **desactivar** y
 * **eliminar**, y no es un matiz:
 *
 * - Desactivar corta el acceso y libera el asiento del plan. La persona queda en
 *   la base, y con ella queda quién hizo cada gestión y quién registró cada
 *   cobro. Es lo que corresponde cuando alguien deja el equipo.
 *
 * - Eliminar borra la fila y también el usuario de Supabase Auth, que es lo
 *   único que libera el email para volver a invitarlo. Por eso **solo se permite
 *   cuando no hay nada que perder**: ninguna gestión, ningún cobro. El caso real
 *   es la invitación que salió mal y hay que rehacer.
 *
 * Si se permitiera borrar a alguien con historial, un reporte de recupero de
 * hace seis meses pasaría a decir que esos cobros no los registró nadie.
 */

export type UserResult<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const idInput = z.object({ userId: idSchema });

/**
 * Chequeos comunes: rol, pertenencia a la organización y las dos formas de
 * dejar la cuenta sin dueño.
 */
async function cargarObjetivo(userId: string) {
  const session = await requireSession();

  if (session.user.role !== "ADMIN") {
    return { ok: false as const, error: "Solo un administrador puede administrar el equipo." };
  }

  if (userId === session.user.id) {
    // Sin esto, un administrador se deja afuera de su propia cuenta y no queda
    // nadie con permiso para volver a entrar a arreglarlo.
    return { ok: false as const, error: "No podés desactivarte ni eliminarte a vos mismo." };
  }

  // El filtro por organizationId no es opcional: Prisma corre con BYPASSRLS, y
  // sin él un administrador podría tocar usuarios de otra empresa.
  const objetivo = await prisma.user.findFirst({
    where: { id: userId, organizationId: session.organization.id },
    select: { id: true, fullName: true, email: true, role: true, isActive: true },
  });

  if (!objetivo) return { ok: false as const, error: "No se encontró el usuario." };

  return { ok: true as const, session, objetivo };
}

/** Que no quede la organización sin ningún administrador activo. */
async function esElUltimoAdmin(organizationId: string, userId: string) {
  const otros = await prisma.user.count({
    where: {
      organizationId,
      role: "ADMIN",
      isActive: true,
      NOT: { id: userId },
    },
  });

  return otros === 0;
}

export async function desactivarUsuario(
  input: z.infer<typeof idInput>,
): Promise<UserResult> {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Usuario inválido." };

  const ctx = await cargarObjetivo(parsed.data.userId);
  if (!ctx.ok) return ctx;
  const { session, objetivo } = ctx;

  if (!objetivo.isActive) return { ok: true };

  if (objetivo.role === "ADMIN" && (await esElUltimoAdmin(session.organization.id, objetivo.id))) {
    return {
      ok: false,
      error: "Es el único administrador activo. Nombrá otro antes de desactivarlo.",
    };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: objetivo.id }, data: { isActive: false } }),
    // El asiento se libera: el plan cobra por gente que puede entrar, no por
    // filas en una tabla.
    prisma.organization.update({
      where: { id: session.organization.id },
      data: { seatsUsed: { decrement: 1 } },
    }),
  ]);

  revalidatePath("/admin/users");
  return { ok: true };
}

export async function reactivarUsuario(
  input: z.infer<typeof idInput>,
): Promise<UserResult> {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Usuario inválido." };

  const ctx = await cargarObjetivo(parsed.data.userId);
  if (!ctx.ok) return ctx;
  const { session, objetivo } = ctx;

  if (objetivo.isActive) return { ok: true };

  const organizacion = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { seatsUsed: true, seatsMax: true },
  });

  if (organizacion.seatsUsed >= organizacion.seatsMax) {
    return {
      ok: false,
      error: `Tu plan permite ${organizacion.seatsMax} usuarios activos. Desactivá a alguien o ampliá el plan.`,
    };
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: objetivo.id }, data: { isActive: true } }),
    prisma.organization.update({
      where: { id: session.organization.id },
      data: { seatsUsed: { increment: 1 } },
    }),
  ]);

  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Elimina de verdad: la fila y el usuario de Supabase Auth.
 *
 * Es lo único que libera el email para volver a invitarlo, y por eso existe. Se
 * niega en cuanto la persona dejó rastro de trabajo.
 */
export async function eliminarUsuario(
  input: z.infer<typeof idInput>,
): Promise<UserResult<{ desasignados: number }>> {
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Usuario inválido." };

  const ctx = await cargarObjetivo(parsed.data.userId);
  if (!ctx.ok) return ctx;
  const { session, objetivo } = ctx;

  if (objetivo.role === "ADMIN" && (await esElUltimoAdmin(session.organization.id, objetivo.id))) {
    return {
      ok: false,
      error: "Es el único administrador activo. Nombrá otro antes de eliminarlo.",
    };
  }

  const [gestiones, cobros, asignados] = await Promise.all([
    prisma.managementAction.count({ where: { operatorId: objetivo.id } }),
    prisma.payment.count({ where: { registeredById: objetivo.id } }),
    prisma.client.count({ where: { assignedToId: objetivo.id } }),
  ]);

  if (gestiones > 0 || cobros > 0) {
    const partes = [
      gestiones > 0 ? `${gestiones} gestiones` : null,
      cobros > 0 ? `${cobros} cobros` : null,
    ].filter(Boolean);

    return {
      ok: false,
      error:
        `${objetivo.fullName} tiene ${partes.join(" y ")} registrados. ` +
        "Desactivalo en vez de eliminarlo: borrarlo dejaría ese historial sin autor.",
    };
  }

  // Primero la base y después Auth. Al revés, si falla el borrado de la fila
  // queda una cuenta de Auth sin usuario en Pand, que es un estado raro y
  // silencioso. Así, lo peor que puede pasar es un usuario de Auth huérfano, que
  // se ve en el dashboard de Supabase y no rompe nada.
  await prisma.$transaction([
    prisma.user.delete({ where: { id: objetivo.id } }),
    ...(objetivo.isActive
      ? [
          prisma.organization.update({
            where: { id: session.organization.id },
            data: { seatsUsed: { decrement: 1 } },
          }),
        ]
      : []),
  ]);

  try {
    await createAdminClient().auth.admin.deleteUser(objetivo.id);
  } catch {
    // Si Auth no responde, la fila ya no está y la persona no puede entrar. Lo
    // único que queda pendiente es que el email siga ocupado para una nueva
    // invitación, y eso se resuelve desde el dashboard de Supabase.
    revalidatePath("/admin/users");
    return {
      ok: false,
      error:
        "Se eliminó el usuario, pero no se pudo liberar el email en Supabase. " +
        "Para volver a invitarlo hay que borrarlo desde Authentication → Users.",
    };
  }

  revalidatePath("/admin/users");
  return { ok: true, desasignados: asignados };
}
