"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { idSchema } from "@/lib/validation/id";

import type { Plan, Sector } from "@/generated/prisma/enums";
import { slugify, uniqueSlug } from "@/lib/org/slug";
import { getPlatformSession } from "@/lib/platform/access";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Acciones del backoffice de Pand.
 *
 * Todas empiezan igual y no es ceremonia: son las únicas acciones del producto
 * que pueden tocar datos de cualquier empresa cliente, así que cada una verifica
 * por su cuenta. Un día alguien va a agregar una función acá abajo y el patrón
 * repetido es lo que hace evidente qué falta.
 */

export type PlatformResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const PLANES = ["STARTER", "GROWTH", "PROFESSIONAL", "ENTERPRISE"] as const satisfies readonly Plan[];
const SECTORES = ["FINANCIAL", "B2B", "TELECOM", "RETAIL"] as const satisfies readonly Sector[];

/** Asientos por defecto de cada plan. Se pueden ajustar a mano después. */
const ASIENTOS_POR_PLAN: Record<Plan, number> = {
  STARTER: 3,
  GROWTH: 10,
  PROFESSIONAL: 25,
  ENTERPRISE: 100,
};

async function requirePlatform() {
  return getPlatformSession();
}

// ───────────────────────── Alta de una empresa ─────────────────────────

const altaSchema = z.object({
  nombre: z.string().trim().min(2).max(80),
  sector: z.enum(SECTORES),
  plan: z.enum(PLANES),
  emailAdmin: z.string().trim().toLowerCase().email().max(160),
  diasDePrueba: z.number().int().min(0).max(365),
});

/**
 * Crea una empresa cliente e invita a su primer administrador.
 *
 * Es lo que hoy no existe de ninguna forma: una organización solo nacía por el
 * registro público, y el registro está cerrado. Sin esto no hay manera de dar de
 * alta a un cliente que firmó.
 *
 * El orden importa. Primero se crea el usuario en Supabase Auth, porque es lo
 * único que puede fallar por motivos ajenos —email inválido, rebote del
 * proveedor, cuota— y es lo único que no se puede deshacer con un rollback. Si
 * eso sale bien, organización y usuario entran juntos en una transacción: una
 * organización sin administrador queda huérfana y nadie puede entrar a
 * arreglarla.
 */
export async function crearEmpresa(
  input: z.infer<typeof altaSchema>,
): Promise<PlatformResult<{ slug: string }>> {
  const session = await requirePlatform();
  if (!session) return { ok: false, error: "No tenés acceso al backoffice." };

  const parsed = altaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const { nombre, sector, plan, emailAdmin, diasDePrueba } = parsed.data;

  if (await prisma.user.findFirst({ where: { email: emailAdmin } })) {
    return { ok: false, error: "Ese email ya tiene cuenta en Pand." };
  }

  const slug = await uniqueSlug(slugify(nombre));

  let authUserId: string;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(emailAdmin, {
      // A definir-password y no a /login: con la invitacion la persona entra
      // una vez por el enlace, pero no tiene contraseña. Mandarla al login la
      // dejaba adentro ese dia y afuera al siguiente.
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/definir-password`,
    });
    if (error) return { ok: false, error: error.message };
    if (!data.user) return { ok: false, error: "No se pudo enviar la invitación." };
    authUserId = data.user.id;
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : "No se pudo invitar al administrador.",
    };
  }

  const trialEnds = diasDePrueba > 0 ? new Date() : null;
  if (trialEnds) trialEnds.setDate(trialEnds.getDate() + diasDePrueba);

  try {
    await prisma.$transaction(async (tx) => {
      const organizacion = await tx.organization.create({
        data: {
          name: nombre,
          slug,
          sector,
          plan,
          seatsMax: ASIENTOS_POR_PLAN[plan],
          seatsUsed: 1,
          trialEnds,
        },
      });

      await tx.user.create({
        data: {
          id: authUserId,
          organizationId: organizacion.id,
          email: emailAdmin,
          fullName: emailAdmin.split("@")[0],
          role: "ADMIN",
        },
      });
    });
  } catch {
    // El usuario de Auth ya existe y la transacción no entró: se limpia para que
    // reintentar con el mismo email no choque contra "ya tiene cuenta".
    try {
      await createAdminClient().auth.admin.deleteUser(authUserId);
    } catch {
      // Si tampoco se puede borrar, queda un usuario de Auth suelto. Es
      // preferible a dejar media organización creada, y se ve en el dashboard
      // de Supabase.
    }
    return { ok: false, error: "No se pudo crear la empresa. No se cambió nada." };
  }

  revalidatePath("/backoffice");
  return { ok: true, slug };
}

// ───────────────────────── Plan y límites ─────────────────────────

const planSchema = z.object({
  organizationId: idSchema,
  plan: z.enum(PLANES),
  seatsMax: z.number().int().min(1).max(1000),
});

export async function actualizarPlan(
  input: z.infer<typeof planSchema>,
): Promise<PlatformResult> {
  const session = await requirePlatform();
  if (!session) return { ok: false, error: "No tenés acceso al backoffice." };

  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const { organizationId, plan, seatsMax } = parsed.data;

  const organizacion = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { seatsUsed: true },
  });
  if (!organizacion) return { ok: false, error: "No se encontró la empresa." };

  // Bajar el límite por debajo de los usuarios que ya existen dejaría la cuenta
  // en un estado imposible: no se puede invitar a nadie y tampoco se sabe a
  // quién habría que sacar. Que lo decida la empresa, no nosotros.
  if (seatsMax < organizacion.seatsUsed) {
    return {
      ok: false,
      error: `La empresa ya tiene ${organizacion.seatsUsed} usuarios. Desactivá usuarios antes de bajar el límite a ${seatsMax}.`,
    };
  }

  await prisma.organization.update({
    where: { id: organizationId },
    data: { plan, seatsMax },
  });

  revalidatePath("/backoffice");
  return { ok: true };
}

// ───────────────────────── Suspender y reactivar ─────────────────────────

const suspensionSchema = z.object({
  organizationId: idSchema,
  suspender: z.boolean(),
});

/**
 * Corta o devuelve el acceso de toda una empresa.
 *
 * No borra nada: la cartera, el historial y los usuarios quedan intactos. Lo
 * único que cambia es que `requireSession` deja de dejar entrar a esa gente.
 */
export async function suspenderEmpresa(
  input: z.infer<typeof suspensionSchema>,
): Promise<PlatformResult> {
  const session = await requirePlatform();
  if (!session) return { ok: false, error: "No tenés acceso al backoffice." };

  const parsed = suspensionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const { organizationId, suspender } = parsed.data;

  // Suspenderse a uno mismo es la forma más rápida de quedarse afuera del
  // producto sin poder volver a entrar a arreglarlo.
  if (suspender && organizationId === session.organization.id) {
    return { ok: false, error: "No podés suspender tu propia organización." };
  }

  const { count } = await prisma.organization.updateMany({
    where: { id: organizationId },
    data: { suspendedAt: suspender ? new Date() : null },
  });
  if (count === 0) return { ok: false, error: "No se encontró la empresa." };

  revalidatePath("/backoffice");
  return { ok: true };
}
