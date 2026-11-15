"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import { importBatchSchema, type MappedRow } from "@/lib/import/row-schema";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { Sector } from "@/generated/prisma/enums";

export type ImportResult =
  | { ok: true; clients: number; invoices: number }
  | { ok: false; error: string };

/**
 * Crea la cartera vacía en estado UPLOADING. Las filas llegan después, por lotes.
 */
export async function createPortfolio(input: {
  name: string;
  sector: Sector;
}): Promise<{ ok: true; portfolioId: string } | { ok: false; error: string }> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Los operadores no pueden cargar carteras." };
  }

  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false, error: "Poné un nombre para la cartera." };
  }

  const portfolio = await prisma.portfolio.create({
    data: {
      organizationId: session.organization.id,
      name,
      sectorType: input.sector,
      source: "EXCEL",
      status: "UPLOADING",
      uploadedById: session.user.id,
    },
    select: { id: true },
  });

  return { ok: true, portfolioId: portfolio.id };
}

/**
 * Escribe un lote de filas.
 *
 * Deudores y comprobantes se hacen upsert por su llave natural dentro del tenant
 * —`external_id` y `invoice_number`— así que reimportar la misma planilla corrige
 * datos en vez de duplicar cartera.
 */
export async function importBatch(input: {
  portfolioId: string;
  rows: MappedRow[];
}): Promise<ImportResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Los operadores no pueden cargar carteras." };
  }

  const parsed = importBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "El lote llegó con filas inválidas." };
  }

  const { portfolioId, rows } = parsed.data;

  // La cartera tiene que ser de la organización de quien está importando. Prisma
  // corre con BYPASSRLS: sin este chequeo, un id ajeno escribiría en otro tenant.
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, organizationId: session.organization.id },
    select: { id: true, status: true },
  });

  if (!portfolio) {
    return { ok: false, error: "La cartera no existe." };
  }
  if (portfolio.status === "CLOSED") {
    return { ok: false, error: "La cartera está cerrada." };
  }

  const organizationId = session.organization.id;
  const currency = session.organization.currency;

  let clients = 0;
  let invoices = 0;

  // Todo el lote entra o no entra ninguno: si el request se corta a mitad, no queda
  // una cartera con la mitad de los comprobantes cargados.
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      const client = await tx.client.upsert({
        where: {
          organizationId_externalId: { organizationId, externalId: row.externalId },
        },
        create: {
          organizationId,
          portfolioId,
          externalId: row.externalId,
          name: row.name,
          documentNumber: row.documentNumber,
          email: row.email,
          phone: row.phone,
          phoneAlt: row.phoneAlt,
          currency,
        },
        update: {
          // No se pisa portfolioId ni el estado de gestión: si el deudor ya venía de
          // otra cartera y alguien lo está trabajando, reimportar no lo reinicia.
          name: row.name,
          documentNumber: row.documentNumber,
          email: row.email,
          phone: row.phone,
          phoneAlt: row.phoneAlt,
        },
        select: { id: true, createdAt: true, updatedAt: true },
      });

      if (client.createdAt.getTime() === client.updatedAt.getTime()) clients += 1;

      await tx.invoice.upsert({
        where: {
          organizationId_invoiceNumber: {
            organizationId,
            invoiceNumber: row.invoiceNumber,
          },
        },
        create: {
          organizationId,
          clientId: client.id,
          invoiceNumber: row.invoiceNumber,
          product: row.product,
          description: row.description,
          amount: row.amount,
          currency,
          dueDate: new Date(`${row.dueDate}T00:00:00Z`),
        },
        update: {
          clientId: client.id,
          product: row.product,
          description: row.description,
          amount: row.amount,
          dueDate: new Date(`${row.dueDate}T00:00:00Z`),
        },
      });

      invoices += 1;
    }

    await tx.portfolio.update({
      where: { id: portfolioId },
      data: { status: "PROCESSING" },
    });
  });

  return { ok: true, clients, invoices };
}

/**
 * Cierra la carga: recalcula la deuda de los clientes tocados, refresca mora y
 * prioridad, y deja la cartera activa.
 */
export async function finalizePortfolio(
  portfolioId: string,
): Promise<{ ok: true; totalClients: number; totalAmount: number } | { ok: false; error: string }> {
  const session = await requireSession();
  const organizationId = session.organization.id;

  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, organizationId },
    select: { id: true },
  });

  if (!portfolio) return { ok: false, error: "La cartera no existe." };

  // total_debt del cliente = suma de sus comprobantes abiertos. Acá sí se recalcula
  // (a diferencia del cron diario, que no lo toca): el importador ES la fuente de
  // ese número.
  await prisma.$executeRaw`
    UPDATE clients c
       SET total_debt = COALESCE(agg.total, 0),
           updated_at = now()
      FROM (
        SELECT cl.id,
               SUM(i.amount - i.paid_amount) AS total
          FROM clients cl
          JOIN invoices i ON i.client_id = cl.id
                         AND i.status IN ('PENDING', 'PARTIAL')
         WHERE cl.organization_id = ${organizationId}::uuid
           AND cl.portfolio_id = ${portfolioId}::uuid
         GROUP BY cl.id
      ) agg
     WHERE c.id = agg.id
  `;

  // Deja días de mora y prioridad al día sin esperar al cron de las 03:15.
  await prisma.$executeRaw`SELECT public.refresh_overdue_and_priority()`;

  const totals = await prisma.client.aggregate({
    where: { organizationId, portfolioId },
    _count: { id: true },
    _sum: { totalDebt: true },
  });

  const totalClients = totals._count.id;
  const totalAmount = Number(totals._sum.totalDebt ?? 0);

  await prisma.portfolio.update({
    where: { id: portfolioId },
    data: { status: "ACTIVE", totalClients, totalAmount },
  });

  revalidatePath("/portfolio");
  revalidatePath("/overview");

  return { ok: true, totalClients, totalAmount };
}

/**
 * Guarda el mapeo de columnas para reusarlo en las próximas cargas.
 *
 * Va en `organization.settings` y no en la cartera porque el valor está justamente
 * en cruzar cargas: el ERP del cliente exporta siempre los mismos encabezados, así
 * que la segunda importación no debería pedir el mapeo de nuevo. Se guarda por
 * sector, que es lo que determina los campos.
 */
export async function saveColumnMapping(input: {
  sector: Sector;
  mapping: Record<string, string>;
}): Promise<void> {
  const session = await requireSession();

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { settings: true },
  });

  const settings =
    organization.settings && typeof organization.settings === "object"
      ? (organization.settings as Record<string, unknown>)
      : {};

  const saved =
    settings.columnMappings && typeof settings.columnMappings === "object"
      ? (settings.columnMappings as Record<string, Record<string, string>>)
      : {};

  // `settings` es Json: Prisma no acepta un objeto con valores `unknown`, así que se
  // arma el valor completo y se afirma una sola vez, acá.
  const next = {
    ...settings,
    columnMappings: { ...saved, [input.sector]: input.mapping },
  } as Prisma.InputJsonObject;

  await prisma.organization.update({
    where: { id: session.organization.id },
    data: { settings: next },
  });
}

/** Descarta una carga a medio hacer. */
export async function discardPortfolio(portfolioId: string): Promise<void> {
  const session = await requireSession();

  await prisma.portfolio.deleteMany({
    where: {
      id: portfolioId,
      organizationId: session.organization.id,
      // Solo se puede descartar lo que todavía no quedó activo.
      status: { in: ["UPLOADING", "PROCESSING"] },
    },
  });

  revalidatePath("/portfolio");
}
