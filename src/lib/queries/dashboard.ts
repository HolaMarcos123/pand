import {
  TRAMOS,
  TRAMO_LABELS,
  tramoSql,
  type Tramo,
} from "@/lib/collections/tramos";
import { prisma } from "@/lib/prisma";

/**
 * Consultas del dashboard (P03).
 *
 * Van en SQL crudo y no con el query builder porque son agregaciones con buckets y
 * subconsultas correlacionadas: en Prisma quedarían como varias vueltas a la base
 * más un agrupado en JavaScript.
 *
 * Dos reglas que no se pueden relajar:
 *
 *   1. TODA consulta filtra por organization_id. Prisma corre como `postgres`, que
 *      tiene BYPASSRLS, así que las policies no van a atajar un olvido acá.
 *   2. Los montos se castean a ::float8 y los conteos a ::int. Sin eso, node-postgres
 *      devuelve los numeric como string y los count como BigInt, que ni se suman ni
 *      se serializan hacia un Client Component.
 */

/** Facturas que todavía deben plata. Las pagadas y anuladas no son cartera. */
const OPEN_INVOICE_STATUSES = ["PENDING", "PARTIAL"] as const;

export type Kpis = {
  recoveredAmount: number;
  openDebt: number;
  recoveryRate: number;
  promisedAmount: number;
  promisesCount: number;
  overdue90Amount: number;
  overdue90Rate: number;
  /** Castigado: fuera de la cartera activa, se informa aparte. */
  writtenOffAmount: number;
};

export type Tranche = { key: Tramo; label: string; amount: number };

export type OperatorRow = {
  id: string;
  fullName: string;
  clients: number;
  contacts: number;
  promises: number;
  collected: number;
};

export async function getKpis(organizationId: string): Promise<Kpis> {
  const [recovered, open, promises, overdue, castigado] = await Promise.all([
    prisma.$queryRaw<[{ amount: number }]>`
      SELECT COALESCE(SUM(amount), 0)::float8 AS amount
        FROM payments
       WHERE organization_id = ${organizationId}::uuid
         AND payment_date >= date_trunc('month', CURRENT_DATE)
    `,
    prisma.$queryRaw<[{ amount: number }]>`
      SELECT COALESCE(SUM(amount - paid_amount), 0)::float8 AS amount
        FROM invoices
       WHERE organization_id = ${organizationId}::uuid
         AND status = ANY(${OPEN_INVOICE_STATUSES as unknown as string[]}::"InvoiceStatus"[])
    `,
    prisma.$queryRaw<[{ amount: number; count: number }]>`
      SELECT COALESCE(SUM(promise_amount), 0)::float8 AS amount,
             COUNT(*)::int AS count
        FROM management_actions
       WHERE organization_id = ${organizationId}::uuid
         AND result = 'PROMISE_PAY'
         AND promise_date >= CURRENT_DATE
    `,
    prisma.$queryRaw<[{ amount: number }]>`
      SELECT COALESCE(SUM(amount - paid_amount), 0)::float8 AS amount
        FROM invoices
       WHERE organization_id = ${organizationId}::uuid
         AND status = ANY(${OPEN_INVOICE_STATUSES as unknown as string[]}::"InvoiceStatus"[])
         AND days_overdue > 90
    `,
    // Castigado: fuera de la cartera activa. Se mide aparte justamente para no
    // sumarlo al saldo activo, que es el bug #16 del QA de CobrAI.
    prisma.$queryRaw<[{ amount: number }]>`
      SELECT COALESCE(SUM(amount - paid_amount), 0)::float8 AS amount
        FROM invoices
       WHERE organization_id = ${organizationId}::uuid
         AND status = 'WRITTEN_OFF'
    `,
  ]);

  const recoveredAmount = recovered[0]?.amount ?? 0;
  const openDebt = open[0]?.amount ?? 0;
  const overdue90Amount = overdue[0]?.amount ?? 0;

  // El recupero se mide contra lo que había para cobrar al empezar el mes, que es
  // lo cobrado más lo que sigue abierto. Sobre la deuda actual sola daría de más.
  const base = recoveredAmount + openDebt;

  return {
    recoveredAmount,
    openDebt,
    recoveryRate: base ? (recoveredAmount / base) * 100 : 0,
    promisedAmount: promises[0]?.amount ?? 0,
    promisesCount: promises[0]?.count ?? 0,
    overdue90Amount,
    overdue90Rate: openDebt ? (overdue90Amount / openDebt) * 100 : 0,
    writtenOffAmount: castigado[0]?.amount ?? 0,
  };
}

/**
 * Cartera **activa** repartida por tramo.
 *
 * Los tramos salen de `lib/collections/tramos`, el mismo catálogo que usan la tabla
 * de clientes y los filtros. El castigo no aparece acá porque no es cartera activa:
 * se informa como KPI aparte.
 */
export async function getTranches(organizationId: string): Promise<Tranche[]> {
  const rows = await prisma.$queryRaw<{ bucket: string; amount: number }[]>`
    SELECT ${tramoSql()} AS bucket,
           COALESCE(SUM(i.amount - i.paid_amount), 0)::float8 AS amount
      FROM invoices i
     WHERE i.organization_id = ${organizationId}::uuid
       AND i.status = ANY(${OPEN_INVOICE_STATUSES as unknown as string[]}::"InvoiceStatus"[])
     GROUP BY 1
  `;

  const encontrados = new Map(rows.map((row) => [row.bucket, row.amount]));

  // Orden fijo y tramos completos: un GROUP BY no devuelve los vacíos, y el gráfico
  // necesita todas las barras siempre, aunque valgan cero.
  return TRAMOS.map((t) => ({
    key: t.key,
    label: TRAMO_LABELS[t.key],
    amount: encontrados.get(t.key) ?? 0,
  }));
}

/** Tabla de operadores del mes, ordenada por lo cobrado. */
export async function getOperatorStats(
  organizationId: string,
): Promise<OperatorRow[]> {
  return prisma.$queryRaw<OperatorRow[]>`
    SELECT u.id,
           u.full_name AS "fullName",
           (SELECT COUNT(*)::int
              FROM clients c
             WHERE c.assigned_to = u.id
               AND c.organization_id = u.organization_id) AS clients,
           (SELECT COUNT(*)::int
              FROM management_actions ma
             WHERE ma.operator_id = u.id
               AND ma.created_at >= date_trunc('month', CURRENT_DATE)) AS contacts,
           (SELECT COUNT(*)::int
              FROM management_actions ma
             WHERE ma.operator_id = u.id
               AND ma.result = 'PROMISE_PAY'
               AND ma.created_at >= date_trunc('month', CURRENT_DATE)) AS promises,
           (SELECT COALESCE(SUM(p.amount), 0)::float8
              FROM payments p
             WHERE p.registered_by = u.id
               AND p.payment_date >= date_trunc('month', CURRENT_DATE)) AS collected
      FROM users u
     WHERE u.organization_id = ${organizationId}::uuid
       AND u.is_active
     ORDER BY collected DESC, u.full_name ASC
  `;
}

/** Cantidad de tareas del día del operador, para el badge del sidebar. */
export async function getTaskCount(
  organizationId: string,
  userId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<[{ count: number }]>`
    SELECT COUNT(*)::int AS count
      FROM clients
     WHERE organization_id = ${organizationId}::uuid
       AND assigned_to = ${userId}::uuid
       AND status NOT IN ('PAID', 'LOST')
       AND (next_action_at IS NULL OR next_action_at <= now())
  `;

  return rows[0]?.count ?? 0;
}
