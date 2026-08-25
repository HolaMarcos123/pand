import { Prisma } from "@/generated/prisma/client";
import type { ClientPriority, ClientStatus, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export type TaskRow = {
  id: string;
  name: string;
  documentNumber: string | null;
  phone: string | null;
  totalDebt: number;
  priority: ClientPriority;
  status: ClientStatus;
  daysOverdue: number;
  lastContactAt: string | null;
  lastActionType: string | null;
  assignedToName: string | null;
};

export type TaskFilters = {
  portfolioId?: string;
  priority?: ClientPriority;
  status?: ClientStatus;
};

/**
 * La bandeja del día.
 *
 * Qué entra, según el brief: deudores que no estén pagados ni perdidos y cuyo próximo
 * seguimiento ya venció (o que nunca tuvieron uno).
 *
 * Vale notar que **no hace falta ningún cron para que un cliente "vuelva" a la
 * bandeja**. El brief propone un job horario que los devuelva, pero la condición
 * `next_action_at <= now()` ya los trae sola en cuanto pasa la hora. Un job que
 * reescribiera filas para lograr lo mismo solo agregaría escrituras y una ventana en
 * la que la bandeja miente durante hasta una hora.
 *
 * El operador ve únicamente lo suyo. Supervisores y administradores ven todo: son
 * quienes reparten la carga.
 */
export async function getTasks(
  organizationId: string,
  userId: string,
  role: Role,
  filters: TaskFilters = {},
): Promise<TaskRow[]> {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`c.organization_id = ${organizationId}::uuid`,
    Prisma.sql`c.status NOT IN ('PAID', 'LOST')`,
    Prisma.sql`(c.next_action_at IS NULL OR c.next_action_at <= now())`,
  ];

  if (role === "OPERATOR") {
    conditions.push(Prisma.sql`c.assigned_to = ${userId}::uuid`);
  }
  if (filters.portfolioId) {
    conditions.push(Prisma.sql`c.portfolio_id = ${filters.portfolioId}::uuid`);
  }
  if (filters.priority) {
    conditions.push(Prisma.sql`c.priority = ${filters.priority}::"ClientPriority"`);
  }
  if (filters.status) {
    conditions.push(Prisma.sql`c.status = ${filters.status}::"ClientStatus"`);
  }

  return prisma.$queryRaw<TaskRow[]>`
    SELECT c.id,
           c.name,
           c.document_number AS "documentNumber",
           c.phone,
           c.total_debt::float8 AS "totalDebt",
           c.priority,
           c.status,
           COALESCE(mora.dias, 0) AS "daysOverdue",
           to_char(ultima.created_at, 'YYYY-MM-DD') AS "lastContactAt",
           ultima.action_type::text AS "lastActionType",
           u.full_name AS "assignedToName"
      FROM clients c
      LEFT JOIN users u ON u.id = c.assigned_to
      -- LATERAL y no subconsulta en el SELECT: se evalúa una vez por cliente aunque
      -- se usen dos columnas de cada bloque.
      LEFT JOIN LATERAL (
        SELECT MAX(i.days_overdue) AS dias
          FROM invoices i
         WHERE i.client_id = c.id
           AND i.status IN ('PENDING', 'PARTIAL')
      ) mora ON true
      LEFT JOIN LATERAL (
        SELECT ma.created_at, ma.action_type
          FROM management_actions ma
         WHERE ma.client_id = c.id
         ORDER BY ma.created_at DESC
         LIMIT 1
      ) ultima ON true
     WHERE ${Prisma.join(conditions, " AND ")}
     -- Orden del brief: critical → high → medium → low, y dentro de cada tramo la
     -- deuda más grande primero. Es el orden en que conviene gastar el día.
     ORDER BY array_position(
                ARRAY['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']::"ClientPriority"[],
                c.priority
              ),
              c.total_debt DESC
     LIMIT 500
  `;
}

export type ClientDetail = {
  id: string;
  name: string;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  phoneAlt: string | null;
  totalDebt: number;
  currency: string;
  priority: ClientPriority;
  status: ClientStatus;
  riskScore: number | null;
  daysOverdue: number;
  invoices: {
    id: string;
    invoiceNumber: string;
    description: string | null;
    amount: number;
    paidAmount: number;
    dueDate: string;
    daysOverdue: number;
    status: string;
  }[];
  history: {
    id: string;
    actionType: string;
    result: string | null;
    comment: string | null;
    operatorName: string | null;
    createdAt: string;
    promiseAmount: number | null;
    promiseDate: string | null;
  }[];
};

/** Ficha completa para el panel lateral. */
export async function getClientDetail(
  organizationId: string,
  clientId: string,
): Promise<ClientDetail | null> {
  const client = await prisma.client.findFirst({
    // El filtro por organizationId no es opcional: Prisma corre con BYPASSRLS y un
    // id de otro tenant traeria su ficha entera.
    where: { id: clientId, organizationId },
    select: {
      id: true,
      name: true,
      documentNumber: true,
      email: true,
      phone: true,
      phoneAlt: true,
      totalDebt: true,
      currency: true,
      priority: true,
      status: true,
      riskScore: true,
      invoices: {
        orderBy: { dueDate: "asc" },
        select: {
          id: true,
          invoiceNumber: true,
          description: true,
          amount: true,
          paidAmount: true,
          dueDate: true,
          daysOverdue: true,
          status: true,
        },
      },
      managementActions: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          actionType: true,
          result: true,
          comment: true,
          createdAt: true,
          promiseAmount: true,
          promiseDate: true,
          operator: { select: { fullName: true } },
        },
      },
    },
  });

  if (!client) return null;

  const open = client.invoices.filter(
    (i) => i.status === "PENDING" || i.status === "PARTIAL",
  );

  return {
    id: client.id,
    name: client.name,
    documentNumber: client.documentNumber,
    email: client.email,
    phone: client.phone,
    phoneAlt: client.phoneAlt,
    totalDebt: Number(client.totalDebt),
    currency: client.currency,
    priority: client.priority,
    status: client.status,
    riskScore: client.riskScore,
    daysOverdue: open.reduce((max, i) => Math.max(max, i.daysOverdue), 0),
    invoices: client.invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      description: invoice.description,
      amount: Number(invoice.amount),
      paidAmount: Number(invoice.paidAmount),
      dueDate: invoice.dueDate.toISOString().slice(0, 10),
      daysOverdue: invoice.daysOverdue,
      status: invoice.status,
    })),
    history: client.managementActions.map((action) => ({
      id: action.id,
      actionType: action.actionType,
      result: action.result,
      comment: action.comment,
      operatorName: action.operator?.fullName ?? null,
      createdAt: action.createdAt.toISOString(),
      promiseAmount: action.promiseAmount ? Number(action.promiseAmount) : null,
      promiseDate: action.promiseDate?.toISOString().slice(0, 10) ?? null,
    })),
  };
}

/** Carteras activas, para el filtro. */
export async function getPortfolioOptions(organizationId: string) {
  return prisma.portfolio.findMany({
    where: { organizationId, status: { in: ["ACTIVE", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
}
