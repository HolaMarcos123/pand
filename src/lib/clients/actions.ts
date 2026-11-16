"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { idSchema } from "@/lib/validation/id";

import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export type AssignResult =
  | { ok: true; assigned: number }
  | { ok: false; error: string };

const assignSchema = z.object({
  clientIds: z.array(idSchema).min(1).max(500),
  /** null desasigna. */
  operatorId: idSchema.nullable(),
});

/**
 * Asigna (o desasigna) deudores a un operador.
 *
 * Sin esto la bandeja de un operador está vacía para siempre: el importador no
 * escribe `assigned_to`, así que una cartera recién importada no es trabajable por
 * nadie hasta que alguien reparta.
 *
 * Los operadores no reparten: solo administradores y supervisores, como define la
 * matriz de permisos («Asignar operadores a clientes: Admin ✅ Supervisor ✅»).
 */
export async function assignClients(
  input: z.infer<typeof assignSchema>,
): Promise<AssignResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Solo un administrador o supervisor puede asignar." };
  }

  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Selección inválida." };

  const { clientIds, operatorId } = parsed.data;
  const organizationId = session.organization.id;

  // El destinatario tiene que ser de esta organización. Sin este chequeo se podría
  // asignar cartera a un usuario de otro tenant: Prisma corre con BYPASSRLS.
  if (operatorId) {
    const target = await prisma.user.findFirst({
      where: { id: operatorId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!target) {
      return { ok: false, error: "Ese usuario no existe o no está activo." };
    }
  }

  // updateMany con el filtro de organización: los ids vienen del cliente y no se
  // confía en ellos. Los que no sean del tenant simplemente no entran en el UPDATE.
  const result = await prisma.client.updateMany({
    where: { id: { in: clientIds }, organizationId },
    data: { assignedToId: operatorId },
  });

  revalidatePath("/clients");
  revalidatePath("/tasks");

  return { ok: true, assigned: result.count };
}

const distributeSchema = z.object({
  operatorIds: z.array(idSchema).min(1).max(50),
  /** Limitar el reparto a una cartera; sin esto, toda la organización. */
  portfolioId: idSchema.nullable(),
  /** Incluir también los que ya tienen operador (reasignar todo). */
  includeAssigned: z.boolean(),
});

/**
 * Reparte deudores entre varios operadores, en round-robin por deuda descendente.
 *
 * El orden importa: repartir ordenando por deuda y rotando operadores le da a cada
 * uno una mezcla pareja de casos grandes y chicos. Repartir al azar deja a alguien
 * con toda la cartera pesada, y repartir en bloques, peor todavía.
 *
 * Va en SQL de una sola pasada porque una cartera importada puede tener decenas de
 * miles de filas y hacerlo fila por fila desde Node sería una tormenta de queries.
 */
export async function distributeClients(
  input: z.infer<typeof distributeSchema>,
): Promise<AssignResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Solo un administrador o supervisor puede repartir." };
  }

  const parsed = distributeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de reparto inválidos." };

  const { operatorIds, portfolioId, includeAssigned } = parsed.data;
  const organizationId = session.organization.id;

  // Todos los destinatarios tienen que ser de esta organización y estar activos.
  const valid = await prisma.user.findMany({
    where: { id: { in: operatorIds }, organizationId, isActive: true },
    select: { id: true },
  });

  if (valid.length !== operatorIds.length) {
    return { ok: false, error: "Alguno de los usuarios elegidos no es válido." };
  }

  const ids = valid.map((u) => u.id);

  const assigned = await prisma.$executeRaw`
    WITH elegibles AS (
      SELECT c.id,
             row_number() OVER (ORDER BY c.total_debt DESC, c.id) - 1 AS rn
        FROM clients c
       WHERE c.organization_id = ${organizationId}::uuid
         -- Un deudor pagado o perdido no se trabaja, no tiene sentido repartirlo.
         AND c.status NOT IN ('PAID', 'LOST')
         AND (${includeAssigned}::boolean OR c.assigned_to IS NULL)
         AND (${portfolioId}::uuid IS NULL OR c.portfolio_id = ${portfolioId}::uuid)
    ),
    operadores AS (
      SELECT id, (ord - 1) AS slot
        FROM unnest(${ids}::uuid[]) WITH ORDINALITY AS t(id, ord)
    )
    UPDATE clients c
       SET assigned_to = o.id,
           updated_at  = now()
      FROM elegibles e
      JOIN operadores o ON o.slot = e.rn % ${ids.length}
     WHERE c.id = e.id
  `;

  revalidatePath("/clients");
  revalidatePath("/tasks");

  return { ok: true, assigned };
}

// ───────────────────────── Segmentos ─────────────────────────

/**
 * Las claves que un segmento puede guardar: exactamente los filtros de /clients.
 *
 * Se guarda el querystring y no una consulta propia. Así un segmento no puede
 * desincronizarse de la pantalla, y agregar un filtro nuevo no obliga a migrar los
 * segmentos que ya existen. La lista blanca está porque lo guardado se vuelve a
 * pegar en una URL: sin ella, cualquiera podría dejar basura en el link de todos.
 */
const SEGMENT_KEYS = [
  "q",
  "portfolio",
  "priority",
  "status",
  "assigned",
  "tramo",
  "product",
] as const;

const segmentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  // partialRecord y no record: en Zod 4 un record con claves de enum las exige
  // todas, así que guardar un segmento con un solo filtro habría sido rechazado.
  filters: z
    .partialRecord(z.enum(SEGMENT_KEYS), z.string().trim().max(120))
    .refine((value) => Object.values(value).some(Boolean), {
      message: "un segmento sin ningún filtro es la lista completa",
    }),
});

export type SegmentResult = { ok: true } | { ok: false; error: string };

/**
 * Guarda los filtros actuales con un nombre.
 *
 * Es de la organización, no del usuario: el sentido de un segmento es que el
 * supervisor arme "Legal sin asignar" una vez y todo el equipo trabaje sobre la
 * misma definición. Por eso tampoco lo puede crear un operador.
 */
export async function saveSegment(
  input: z.infer<typeof segmentSchema>,
): Promise<SegmentResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Solo un supervisor puede guardar segmentos." };
  }

  const parsed = segmentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Datos inválidos.",
    };
  }

  const { name, filters } = parsed.data;
  // Las claves vacías no se guardan: ensucian el link y hacen que dos segmentos
  // iguales se vean distintos.
  const limpios = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value),
  );

  try {
    await prisma.segment.upsert({
      where: {
        organizationId_name: { organizationId: session.organization.id, name },
      },
      create: {
        organizationId: session.organization.id,
        name,
        filters: limpios,
        createdById: session.user.id,
      },
      // Guardar con un nombre que ya existe lo actualiza. Es lo que espera quien
      // ajusta un filtro y lo vuelve a guardar igual.
      update: { filters: limpios, createdById: session.user.id },
    });
  } catch {
    return { ok: false, error: "No se pudo guardar el segmento." };
  }

  revalidatePath("/clients");
  return { ok: true };
}

export async function deleteSegment(id: string): Promise<SegmentResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Solo un supervisor puede borrar segmentos." };
  }
  if (!idSchema.safeParse(id).success) {
    return { ok: false, error: "Segmento inválido." };
  }

  // deleteMany con el organizationId en el where: un delete por id solo borraría
  // igual, pero dejaría que una organización toque el segmento de otra.
  const { count } = await prisma.segment.deleteMany({
    where: { id, organizationId: session.organization.id },
  });
  if (count === 0) return { ok: false, error: "No se encontró el segmento." };

  revalidatePath("/clients");
  return { ok: true };
}
