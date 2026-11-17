"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { idSchema } from "@/lib/validation/id";

/**
 * Referencias personales de un deudor: a quién llamar cuando no atiende.
 *
 * Las carga el importador cuando la planilla las trae, y el operador cuando las
 * consigue hablando. Ese segundo caso es el que importa: la referencia que sirve
 * casi nunca viene en el archivo, la consigue alguien en una llamada.
 */

export type ReferenceResult = { ok: true } | { ok: false; error: string };

const altaSchema = z.object({
  clientId: idSchema,
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(40).optional().nullable(),
  relation: z.string().trim().max(60).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
});

/**
 * El operador puede cargar referencias de SUS deudores, nadie de los ajenos.
 *
 * Es el mismo criterio que el resto de la bandeja: supervisores y
 * administradores ven toda la cartera, el operador solo lo suyo.
 */
async function puedeTocar(clientId: string) {
  const session = await requireSession();

  const cliente = await prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId: session.organization.id,
      // Prisma corre con BYPASSRLS: el filtro por organización va escrito, no
      // se asume.
      ...(session.user.role === "OPERATOR" ? { assignedToId: session.user.id } : {}),
    },
    select: { id: true },
  });

  if (!cliente) return null;
  return session;
}

export async function agregarReferencia(
  input: z.infer<typeof altaSchema>,
): Promise<ReferenceResult> {
  const parsed = altaSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const session = await puedeTocar(parsed.data.clientId);
  if (!session) return { ok: false, error: "No se encontró el deudor." };

  await prisma.clientReference.create({
    data: {
      organizationId: session.organization.id,
      clientId: parsed.data.clientId,
      name: parsed.data.name,
      phone: parsed.data.phone || null,
      relation: parsed.data.relation || null,
      notes: parsed.data.notes || null,
    },
  });

  revalidatePath("/tasks");
  revalidatePath("/clients");
  return { ok: true };
}

export async function borrarReferencia(input: {
  referenceId: string;
}): Promise<ReferenceResult> {
  const parsed = z.object({ referenceId: idSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Referencia inválida." };

  const session = await requireSession();

  // Se resuelve el deudor primero para aplicarle la misma regla de visibilidad
  // que al alta: un operador no borra referencias de deudores que no gestiona.
  const referencia = await prisma.clientReference.findFirst({
    where: {
      id: parsed.data.referenceId,
      organizationId: session.organization.id,
    },
    select: { id: true, clientId: true },
  });

  if (!referencia) return { ok: false, error: "No se encontró la referencia." };
  if (!(await puedeTocar(referencia.clientId))) {
    return { ok: false, error: "No se encontró la referencia." };
  }

  await prisma.clientReference.delete({ where: { id: referencia.id } });

  revalidatePath("/tasks");
  revalidatePath("/clients");
  return { ok: true };
}
