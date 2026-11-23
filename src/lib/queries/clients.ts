import { Prisma } from "@/generated/prisma/client";
import type { ClientPriority, ClientStatus, Role } from "@/generated/prisma/enums";
import { tramoCliente, type Tramo } from "@/lib/collections/tramos";
import { tramoClienteSql } from "@/lib/collections/tramos-sql";
import { prisma } from "@/lib/prisma";

export const CLIENTS_PER_PAGE = 25;

/**
 * Resumen de los comprobantes del deudor, en un solo recorrido.
 *
 * Va como fragmento porque lo necesitan las dos consultas —la página y el conteo—
 * y porque el filtro por tramo se apoya en sus columnas. Si el conteo no lo
 * trajera, filtrar por tramo daría un total que no coincide con las filas.
 */
const MORA_LATERAL = Prisma.sql`
  LEFT JOIN LATERAL (
    -- La moneda que define la conversación: la que concentra más saldo abierto.
    --
    -- Antes salía de un MIN(), que con un deudor que debe en dos monedas elegía
    -- una al azar y le ponía ese símbolo a una suma de las dos. Un deudor con
    -- 500 dólares y 500 mil guaraníes aparecía debiendo "Gs. 500.500".
    SELECT i2.currency
      FROM invoices i2
     WHERE i2.client_id = c.id
       AND i2.status IN ('PENDING', 'PARTIAL')
     GROUP BY i2.currency
     ORDER BY SUM(i2.amount - i2.paid_amount) DESC, i2.currency
     LIMIT 1
  ) dom ON true
  LEFT JOIN LATERAL (
    SELECT MAX(i.days_overdue) FILTER (WHERE i.status IN ('PENDING', 'PARTIAL')) AS dias,
           -- Las cifras de plata van SOLO en la moneda principal. Sumar monedas
           -- distintas da un número que no significa nada, y en una lista de
           -- cobranzas ese número es el que decide a quién se llama primero.
           -- Cuando el deudor debe en más de una, la columna monedas lo dice y
           -- la ficha muestra el detalle separado.
           COALESCE(SUM(i.amount - i.paid_amount) FILTER (
             WHERE i.status IN ('PENDING', 'PARTIAL')
               AND i.currency = dom.currency
               AND i.due_date <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date
           ), 0)::float8 AS del_mes,
           COALESCE(SUM(i.amount - i.paid_amount) FILTER (
             WHERE i.status IN ('PENDING', 'PARTIAL')
               AND i.currency = dom.currency
           ), 0)::float8 AS total,
           COUNT(DISTINCT i.currency) FILTER (WHERE i.status IN ('PENDING', 'PARTIAL'))::int AS monedas,
           COUNT(*) FILTER (WHERE i.status IN ('PENDING', 'PARTIAL'))::int       AS abiertos,
           COUNT(*) FILTER (WHERE i.status = 'WRITTEN_OFF')::int                 AS castigados,
           string_agg(DISTINCT i.product, ', ')                                  AS productos
      FROM invoices i
     WHERE i.client_id = c.id
  ) mora ON true`;

const TRAMO_DEL_CLIENTE = tramoClienteSql(
  Prisma.raw("mora.dias"),
  Prisma.raw("mora.abiertos"),
  Prisma.raw("mora.castigados"),
);

export type ClientListRow = {
  id: string;
  name: string;
  documentNumber: string | null;
  externalId: string | null;
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
  /** Tramo del deudor: el peor de sus comprobantes abiertos. */
  tramo: Tramo;
  /** Productos distintos que debe, para no tener que abrir la ficha. */
  products: string | null;
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
  tramo?: Tramo;
  product?: string;
  /** Codigo ISO. Trae los deudores que tienen alguna deuda abierta en esa moneda. */
  currency?: string;
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
  if (filters.tramo) {
    where.push(Prisma.sql`${TRAMO_DEL_CLIENTE} = ${filters.tramo}`);
  }
  if (filters.currency) {
    // Solo las deudas abiertas: un deudor que termino de pagar su credito en
    // dolares no es "un deudor en dolares" para quien arma la cartera de hoy.
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM invoices im
       WHERE im.client_id = c.id
         AND im.organization_id = c.organization_id
         AND im.currency = ${filters.currency}
         AND im.status IN ('PENDING', 'PARTIAL')
    )`);
  }
  if (filters.product) {
    // Igualdad y no ILIKE: el producto viene de un selector armado con los valores
    // que ya existen en la cartera, así que buscar "parecido" solo traería ruido.
    where.push(Prisma.sql`EXISTS (
      SELECT 1 FROM invoices ip
       WHERE ip.client_id = c.id
         AND ip.organization_id = c.organization_id
         AND ip.product = ${filters.product}
    )`);
  }

  const clause = Prisma.join(where, " AND ");
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * CLIENTS_PER_PAGE;

  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<(Omit<ClientListRow, "tramo"> & {
      abiertos: number;
      castigados: number;
    })[]>`
      SELECT c.id,
             c.name,
             c.document_number AS "documentNumber",
             c.external_id     AS "externalId",
             c.phone,
             -- El total, como la deuda del mes, va en la moneda principal y no
             -- en c.total_debt, que es la suma de todas las monedas del deudor.
             COALESCE(mora.total, 0) AS "totalDebt",
             c.priority,
             c.status,
             COALESCE(mora.dias, 0) AS "daysOverdue",
             COALESCE(mora.del_mes, 0) AS "deudaDelMes",
             COALESCE(mora.monedas, 1) AS "monedas",
             COALESCE(dom.currency, c.currency) AS "moneda",
             mora.abiertos,
             mora.castigados,
             mora.productos    AS "products",
             p.name            AS "portfolioName",
             c.assigned_to     AS "assignedToId",
             u.full_name       AS "assignedToName"
        FROM clients c
        LEFT JOIN users u      ON u.id = c.assigned_to
        LEFT JOIN portfolios p ON p.id = c.portfolio_id
        ${MORA_LATERAL}
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
        ${MORA_LATERAL}
       WHERE ${clause}
    `,
  ]);

  const total = counts[0]?.total ?? 0;

  return {
    // El tramo se arma acá y no en SQL para que lo calcule la misma función que usa
    // el resto del producto. La expresión SQL de arriba existe solo para filtrar.
    rows: rows.map((row) => ({
      ...row,
      tramo: tramoCliente(row.daysOverdue, row.abiertos, row.castigados),
    })),
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

/**
 * Los productos que realmente existen en la cartera de la organización.
 *
 * El selector se arma con esto y no con una lista fija: cada cliente de Pand vende
 * otra cosa, y una lista hardcodeada envejece con la primera importación.
 */
export async function getProductOptions(organizationId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ product: string }[]>`
    SELECT DISTINCT product
      FROM invoices
     WHERE organization_id = ${organizationId}::uuid
       AND product IS NOT NULL
       AND product <> ''
     ORDER BY product
     LIMIT 200
  `;

  return rows.map((row) => row.product);
}

/**
 * Las monedas en las que la organizacion tiene deuda abierta.
 *
 * Igual que con los productos, el selector se arma con lo que hay: una
 * financiera que solo opera en guaranies no tiene por que ver el filtro lleno
 * de monedas que nunca va a usar.
 */
export async function getCurrencyOptions(organizationId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ currency: string }[]>`
    SELECT DISTINCT currency
      FROM invoices
     WHERE organization_id = ${organizationId}::uuid
       AND status IN ('PENDING', 'PARTIAL')
     ORDER BY currency
     LIMIT 20
  `;

  return rows.map((row) => row.currency);
}

export type SegmentRow = {
  id: string;
  name: string;
  filters: Record<string, string>;
};

/** Los segmentos de la organización, para la barra de /clients. */
export async function getSegments(organizationId: string): Promise<SegmentRow[]> {
  const rows = await prisma.segment.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, filters: true },
    take: 50,
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    // El JSON de la base es `unknown` para TypeScript: se normaliza acá y no en el
    // componente, que no tiene cómo saber qué se guardó.
    filters: Object.fromEntries(
      Object.entries((row.filters ?? {}) as Record<string, unknown>)
        .filter(([, value]) => typeof value === "string" && value)
        .map(([key, value]) => [key, String(value)]),
    ),
  }));
}
