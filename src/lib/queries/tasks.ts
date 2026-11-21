import { Prisma } from "@/generated/prisma/client";
import type { ClientPriority, ClientStatus, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export type TaskRow = {
  id: string;
  name: string;
  documentNumber: string | null;
  phone: string | null;
  totalDebt: number;
  /** Vencido mas lo que vence dentro del mes. Es lo que se gestiona hoy. */
  deudaDelMes: number;
  /** Cuantas monedas distintas debe. Mas de una no se puede sumar. */
  monedas: number;
  moneda: string;
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
           -- En la moneda principal y no c.total_debt, que suma todas las
           -- monedas del deudor y da un numero que no significa nada.
           COALESCE(mora.total, 0) AS "totalDebt",
           COALESCE(mora.del_mes, 0) AS "deudaDelMes",
           COALESCE(mora.monedas, 1) AS "monedas",
           COALESCE(dom.currency, c.currency) AS "moneda",
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
        -- La moneda que define la conversacion: la que concentra mas saldo.
        -- Antes era un MIN(), que con un deudor que debe en dos monedas elegia
        -- una al azar y le ponia ese simbolo a la suma de las dos.
        SELECT i2.currency
          FROM invoices i2
         WHERE i2.client_id = c.id
           AND i2.status IN ('PENDING', 'PARTIAL')
         GROUP BY i2.currency
         ORDER BY SUM(i2.amount - i2.paid_amount) DESC, i2.currency
         LIMIT 1
      ) dom ON true
      LEFT JOIN LATERAL (
        SELECT MAX(i.days_overdue) AS dias,
               -- Lo que se gestiona hoy: lo vencido mas lo que vence antes de
               -- que termine el mes. El total de deuda abierta incluye cuotas
               -- de dentro de seis meses y no sirve para priorizar el dia.
               --
               -- Las cifras van solo en la moneda principal: en una bandeja de
               -- cobranzas este numero es el que decide a quien se llama
               -- primero, y una suma de guaranies con dolares no ordena nada.
               COALESCE(SUM(i.amount - i.paid_amount) FILTER (
                 WHERE i.currency = dom.currency
                   AND i.due_date <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
               ), 0)::float8 AS del_mes,
               COALESCE(SUM(i.amount - i.paid_amount) FILTER (
                 WHERE i.currency = dom.currency
               ), 0)::float8 AS total,
               COUNT(DISTINCT i.currency)::int AS monedas
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
  /** La moneda principal del deudor. Ver `saldos` para el caso multi-moneda. */
  currency: string;
  /**
   * Saldo abierto por moneda.
   *
   * Un deudor puede tener una prenda en dólares y una tarjeta en guaraníes, y
   * sumarlas daría un número que no significa nada. Son listas separadas
   * justamente para que nadie las sume sin tipo de cambio.
   */
  saldos: {
    currency: string;
    /** Lo abierto, sin importar vencimiento. */
    total: number;
    /** Vencido más lo que vence dentro del mes: lo que se gestiona hoy. */
    delMes: number;
    /** Días de mora del comprobante más viejo en esa moneda. */
    diasMora: number;
  }[];
  priority: ClientPriority;
  status: ClientStatus;
  riskScore: number | null;
  daysOverdue: number;
  /** A quién llamar cuando el deudor no atiende. */
  references: {
    id: string;
    name: string;
    phone: string | null;
    relation: string | null;
    notes: string | null;
  }[];
  /** Carteras distintas en las que este deudor tiene deuda abierta. */
  carteras: string[];
  invoices: {
    id: string;
    invoiceNumber: string;
    portfolioName: string | null;
    product: string | null;
    description: string | null;
    amount: number;
    paidAmount: number;
    currency: string;
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
          product: true,
          description: true,
          amount: true,
          paidAmount: true,
          currency: true,
          dueDate: true,
          daysOverdue: true,
          status: true,
          portfolio: { select: { name: true } },
        },
      },
      references: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          phone: true,
          relation: true,
          notes: true,
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

  // Fin del mes corriente: lo que vence hasta ahí es lo que se gestiona hoy. Un
  // comprobante que vence el 28 ya entra en la conversación del día 2, y el
  // total de deuda abierta —que incluye cuotas de dentro de seis meses— no
  // sirve para eso.
  const finDeMes = new Date();
  finDeMes.setUTCHours(0, 0, 0, 0);
  finDeMes.setUTCMonth(finDeMes.getUTCMonth() + 1, 0);

  const porMoneda = new Map<string, { total: number; delMes: number; diasMora: number }>();
  for (const invoice of open) {
    const saldo = Number(invoice.amount) - Number(invoice.paidAmount);
    const actual = porMoneda.get(invoice.currency) ?? {
      total: 0,
      delMes: 0,
      diasMora: 0,
    };

    actual.total += saldo;
    if (invoice.dueDate <= finDeMes) actual.delMes += saldo;
    actual.diasMora = Math.max(actual.diasMora, invoice.daysOverdue);

    porMoneda.set(invoice.currency, actual);
  }

  // Carteras con deuda abierta. Las que ya se cobraron no interesan: la
  // pregunta del operador es "de qué cartera es lo que le estoy cobrando".
  const carteras = [
    ...new Set(
      open.map((i) => i.portfolio?.name).filter((nombre): nombre is string => Boolean(nombre)),
    ),
  ].sort();

  const saldos = [...porMoneda.entries()]
    .map(([currency, datos]) => ({ currency, ...datos }))
    // La moneda con más saldo primero: es la que define la conversación.
    .sort((a, b) => b.total - a.total);

  return {
    id: client.id,
    name: client.name,
    documentNumber: client.documentNumber,
    email: client.email,
    phone: client.phone,
    phoneAlt: client.phoneAlt,
    totalDebt: Number(client.totalDebt),
    currency: saldos[0]?.currency ?? client.currency,
    saldos,
    references: client.references,
    carteras,
    priority: client.priority,
    status: client.status,
    riskScore: client.riskScore,
    daysOverdue: open.reduce((max, i) => Math.max(max, i.daysOverdue), 0),
    invoices: client.invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      portfolioName: invoice.portfolio?.name ?? null,
      product: invoice.product,
      currency: invoice.currency,
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
