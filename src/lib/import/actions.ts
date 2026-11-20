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
  const ahora = new Date();

  // ───────────────────────────────────────────────────────────────────────────
  // Por qué esto es SQL a mano y no un upsert de Prisma por fila.
  //
  // El costo de importar nunca estuvo en la base: estaba en la cantidad de
  // viajes. Un upsert del deudor más otro del comprobante son dos o tres idas
  // y vueltas POR FILA, una después de la otra. Medido contra la base de
  // prueba: 76,5 ms por fila, de los cuales unos 34 ms son latencia pura de
  // cada consulta —o sea que la base casi no trabajaba, solo esperábamos—.
  // Las mismas 500 filas en sentencias masivas: 2,1 ms por fila. 36 veces.
  // Con 200.000 filas eso es la diferencia entre horas y minutos.
  //
  // Así que el lote entero se escribe en unas pocas sentencias de tamaño fijo:
  // sean 10 filas o 5.000, la cantidad de viajes a la base es la misma.
  // ───────────────────────────────────────────────────────────────────────────

  // Un deudor aparece una vez por cada cuota que debe, así que dentro de un
  // lote su external_id viene repetido. `ON CONFLICT DO UPDATE` no tolera la
  // misma llave dos veces en una sentencia ("cannot affect row a second time"),
  // y esto no es un caso raro: es lo normal en una cartera. Se deduplica acá, y
  // gana la última aparición, igual que hacía el bucle que esto reemplaza.
  const deudores = [...new Map(rows.map((r) => [r.externalId, r])).values()];
  const comprobantes = [...new Map(rows.map((r) => [r.invoiceNumber, r])).values()];

  let clients = 0;

  // Todo el lote entra o no entra ninguno: si el request se corta a mitad, no
  // queda una cartera con la mitad de los comprobantes cargados.
  //
  // El timeout va explícito porque el default de Prisma son 5 segundos, y al
  // pasarlos no corta a mitad de camino: deja correr el cuerpo entero y después
  // **rechaza el commit**, así que el lote se revierte completo. Con el upsert
  // por fila que había antes, un lote de 500 tardaba 38 s contra esta misma base
  // —o sea que se revertía siempre— y en producción daba unos 2 s, pasando
  // raspando. No se vio nunca porque los datos de la demo los pone el seed, no
  // el importador. Ahora un lote lleno tarda medio segundo, pero el margen no se
  // deja al azar.
  await prisma.$transaction(async (tx) => {
    // 1. Deudores.
    //
    // `xmax = 0` es cómo Postgres dice "esta fila la insertó esta sentencia, no
    // la actualizó". Permite contar los deudores nuevos sin una consulta extra.
    //
    // portfolio_id NO se actualiza a propósito: si el deudor ya venía de otra
    // cartera y alguien lo está trabajando, reimportar no lo mueve ni le
    // reinicia el estado de gestión.
    const guardados = await tx.$queryRaw<
      { id: string; external_id: string; nuevo: boolean }[]
    >`
      INSERT INTO clients (
        id, organization_id, portfolio_id, external_id, name,
        document_number, email, phone, phone_alt, currency, updated_at
      )
      SELECT gen_random_uuid(), ${organizationId}::uuid, ${portfolioId}::uuid,
             t.external_id, t.name, t.document_number, t.email, t.phone,
             t.phone_alt, ${currency}, ${ahora}::timestamptz
        FROM unnest(
               ${deudores.map((r) => r.externalId)}::text[],
               ${deudores.map((r) => r.name)}::text[],
               ${deudores.map((r) => r.documentNumber)}::text[],
               ${deudores.map((r) => r.email)}::text[],
               ${deudores.map((r) => r.phone)}::text[],
               ${deudores.map((r) => r.phoneAlt)}::text[]
             ) AS t(external_id, name, document_number, email, phone, phone_alt)
      ON CONFLICT (organization_id, external_id) DO UPDATE
         SET name = EXCLUDED.name,
             document_number = EXCLUDED.document_number,
             email = EXCLUDED.email,
             phone = EXCLUDED.phone,
             phone_alt = EXCLUDED.phone_alt,
             updated_at = EXCLUDED.updated_at
      RETURNING id, external_id, (xmax = 0) AS nuevo
    `;

    clients = guardados.filter((g) => g.nuevo).length;

    const idPorExternal = new Map(guardados.map((g) => [g.external_id, g.id]));

    /** El id del deudor de una fila. Si falta, el lote se cae entero y se revierte. */
    const deudorDe = (row: MappedRow): string => {
      const id = idPorExternal.get(row.externalId);
      if (!id) {
        throw new Error(`El deudor ${row.externalId} no volvió del insert.`);
      }
      return id;
    };

    // 2. Comprobantes.
    await tx.$executeRaw`
      INSERT INTO invoices (
        id, organization_id, client_id, portfolio_id, invoice_number,
        product, description, amount, currency, due_date, updated_at
      )
      SELECT gen_random_uuid(), ${organizationId}::uuid, t.client_id,
             ${portfolioId}::uuid, t.invoice_number, t.product, t.description,
             t.amount, ${currency}, t.due_date, ${ahora}::timestamptz
        FROM unnest(
               ${comprobantes.map(deudorDe)}::uuid[],
               ${comprobantes.map((r) => r.invoiceNumber)}::text[],
               ${comprobantes.map((r) => r.product)}::text[],
               ${comprobantes.map((r) => r.description)}::text[],
               ${comprobantes.map((r) => r.amount.toFixed(2))}::numeric[],
               ${comprobantes.map((r) => r.dueDate)}::date[]
             ) AS t(client_id, invoice_number, product, description, amount, due_date)
      ON CONFLICT (organization_id, invoice_number) DO UPDATE
         SET client_id = EXCLUDED.client_id,
             portfolio_id = EXCLUDED.portfolio_id,
             product = EXCLUDED.product,
             description = EXCLUDED.description,
             amount = EXCLUDED.amount,
             due_date = EXCLUDED.due_date,
             updated_at = EXCLUDED.updated_at
    `;

    // 3. Referencias personales, si la planilla las trae.
    //
    // No hay unique sobre (client_id, name) —dos personas distintas pueden
    // llamarse igual en carteras distintas— así que la deduplicación es
    // explícita: se trae lo que ya existe para estos deudores y se parte en
    // "actualizar" y "crear". Tres sentencias de tamaño fijo en vez de un
    // findFirst por fila, que era el único viaje por fila que quedaba.
    const llave = (clientId: string, name: string) => `${clientId}\u0000${name}`;

    const conReferencia = [
      ...new Map(
        rows
          .filter((r) => r.referenceName)
          .map((r) => [llave(deudorDe(r), r.referenceName as string), r]),
      ).entries(),
    ];

    if (conReferencia.length > 0) {
      const idsDeudores = [...new Set(conReferencia.map(([, r]) => deudorDe(r)))];

      const existentes = await tx.$queryRaw<
        { id: string; client_id: string; name: string }[]
      >`
        SELECT id, client_id, name
          FROM client_references
         WHERE client_id = ANY(${idsDeudores}::uuid[])
      `;

      const idExistente = new Map(
        existentes.map((e) => [llave(e.client_id, e.name), e.id]),
      );

      const aActualizar: { id: string; row: MappedRow }[] = [];
      const aCrear: MappedRow[] = [];

      for (const [clave, row] of conReferencia) {
        const id = idExistente.get(clave);
        if (id) aActualizar.push({ id, row });
        else aCrear.push(row);
      }

      if (aActualizar.length > 0) {
        await tx.$executeRaw`
          UPDATE client_references r
             SET phone = t.phone,
                 relation = t.relation,
                 updated_at = ${ahora}::timestamptz
            FROM unnest(
                   ${aActualizar.map((a) => a.id)}::uuid[],
                   ${aActualizar.map((a) => a.row.referencePhone)}::text[],
                   ${aActualizar.map((a) => a.row.referenceRelation)}::text[]
                 ) AS t(id, phone, relation)
           WHERE r.id = t.id
        `;
      }

      if (aCrear.length > 0) {
        await tx.$executeRaw`
          INSERT INTO client_references (
            id, organization_id, client_id, name, phone, relation, updated_at
          )
          SELECT gen_random_uuid(), ${organizationId}::uuid, t.client_id,
                 t.name, t.phone, t.relation, ${ahora}::timestamptz
            FROM unnest(
                   ${aCrear.map(deudorDe)}::uuid[],
                   ${aCrear.map((r) => r.referenceName)}::text[],
                   ${aCrear.map((r) => r.referencePhone)}::text[],
                   ${aCrear.map((r) => r.referenceRelation)}::text[]
                 ) AS t(client_id, name, phone, relation)
        `;
      }
    }

    await tx.portfolio.update({
      where: { id: portfolioId },
      data: { status: "PROCESSING" },
    });
  }, { timeout: 60_000, maxWait: 15_000 });

  // Cuenta comprobantes distintos, no filas: si la planilla repite un número de
  // comprobante, se escribió uno solo y eso es lo que se informa.
  return { ok: true, clients, invoices: comprobantes.length };
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
