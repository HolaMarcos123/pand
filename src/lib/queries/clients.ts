import { Prisma } from "@/generated/prisma/client";
import type { ClientPriority, ClientStatus, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export const CLIENTS_PER_PAGE = 25;

export type ClientListRow = {
  id: string;
  name: string;
  documentNumber: string | null;
  externalId: string | null;
  phone: string | null;
  totalDebt: number;
  priority: ClientPriority;
  status: ClientStatus;
  daysOverdue: number;
  portfolioName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
};

export type ClientFilters = {
  q?: string;
  portfolioId?: string;
  priority?: ClientPriority;
  status?: ClientStatus;
  /** Un id de usuario, o el literal "unassigned" para los que no tienen operador. */
  assigned?: string;
};

export type ClientListResult = {
  rows: ClientListRow[];
  total: number;
  page: number;
  pages: number;
  /** Cuántos de los que matchean el filtro están sin asignar. */
  unassigned: number;
};

/**
 * Listado de deudores con búsqueda, filtros y paginación.
 *
 * Pagina de verdad (LIMIT/OFFSET + COUNT aparte) y no trae todo para cortar en
 * memoria: una cartera real tiene decenas de miles de filas, y la pantalla donde se
 * asignan deudores es justamente la que se abre con la cartera recién importada.
 *
 * El operador solo ve lo suyo. Supervisores y administradores ven todo, porque son
 * quienes reparten.
 */
export async function getClients(
  organizationId: string,
  userId: string,
  role: Role,
  filters: ClientFilters,
  page: number,
): Promise<ClientListResult> {
  const where: Prisma.Sql[] = [
    Prisma.sql`c.organization_id = ${organizationId}::uuid`,
  ];

  if (role === "OPERATOR") {
    where.push(Prisma.sql`c.assigned_to = ${userId}::uuid`);
  }

  if (filters.q) {
    // ILIKE con comodines a ambos lados: el usuario busca por un pedazo del nombre o
    // por los últimos dígitos del documento, no por el prefijo exacto.
    const term = `%${filters.q}%`;
    where.push(Prisma.sql`(
      c.name ILIKE ${term}
      OR c.document_number ILIKE ${term}
      OR c.external_id ILIKE ${term}
    )`);
  }
  if (filters.portfolioId) {
    where.push(Prisma.sql`c.portfolio_id = ${filters.portfolioId}::uuid`);
  }
  if (filters.priority) {
    where.push(Prisma.sql`c.priority = ${filters.priority}::"ClientPriority"`);
  }
  if (filters.status) {
    where.push(Prisma.sql`c.status = ${filters.status}::"ClientStatus"`);
  }
  if (filters.assigned === "unassigned") {
    where.push(Prisma.sql`c.assigned_to IS NULL`);
  } else if (filters.assigned) {
    where.push(Prisma.sql`c.assigned_to = ${filters.assigned}::uuid`);
  }

  const clause = Prisma.join(where, " AND ");
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * CLIENTS_PER_PAGE;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<ClientListRow[]>`
      SELECT c.id,
             c.name,
             c.document_number AS "documentNumber",
             c.external_id     AS "externalId",
             c.phone,
             c.total_debt::float8 AS "totalDebt",
             c.priority,
             c.status,
             COALESCE(mora.dias, 0) AS "daysOverdue",
             p.name            AS "portfolioName",
             c.assigned_to     AS "assignedToId",
             u.full_name       AS "assignedToName"
        FROM clients c
        LEFT JOIN users u      ON u.id = c.assigned_to
        LEFT JOIN portfolios p ON p.id = c.portfolio_id
        LEFT JOIN LATERAL (
          SELECT MAX(i.days_overdue) AS dias
            FROM invoices i
           WHERE i.client_id = c.id
             AND i.status IN ('PENDING', 'PARTIAL')
        ) mora ON true
       WHERE ${clause}
       ORDER BY array_position(
                  ARRAY['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']::"ClientPriority"[],
                  c.priority
                ),
                c.total_debt DESC
       LIMIT ${CLIENTS_PER_PAGE} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ total: number; unassigned: number }]>`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE c.assigned_to IS NULL)::int AS unassigned
        FROM clients c
       WHERE ${clause}
    `,
  ]);

  const total = counts[0]?.total ?? 0;

  return {
    rows,
    total,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / CLIENTS_PER_PAGE)),
    unassigned: counts[0]?.unassigned ?? 0,
  };
}

/** Operadores y supervisores activos, para el selector de asignación. */
export async function getAssignableUsers(organizationId: string) {
  return prisma.user.findMany({
    where: { organizationId, isActive: true, role: { in: ["OPERATOR", "SUPERVISOR"] } },
    orderBy: { fullName: "asc" },
    select: { id: true, fullName: true, role: true },
  });
}
