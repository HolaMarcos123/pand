import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { TRAMO_LABELS, type Tramo } from "@/lib/collections/tramos";
import {
  getAssignableUsers,
  getClients,
  getProductOptions,
  getSegments,
  type ClientFilters,
} from "@/lib/queries/clients";
import { getPortfolioOptions } from "@/lib/queries/tasks";
import type { ClientPriority, ClientStatus } from "@/generated/prisma/enums";

import { ClientsBoard } from "./clients-board";

export const metadata: Metadata = {
  title: "Clientes",
};

const PRIORITIES: ClientPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const STATUSES: ClientStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "PROMISE",
  "PAID",
  "DISPUTE",
  "LEGAL",
  "LOST",
];

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [session, query] = await Promise.all([requireSession(), searchParams]);

  const filters: ClientFilters = {};
  if (query.q) filters.q = query.q.slice(0, 80);
  if (query.portfolio) filters.portfolioId = query.portfolio;
  if (PRIORITIES.includes(query.priority as ClientPriority)) {
    filters.priority = query.priority as ClientPriority;
  }
  if (STATUSES.includes(query.status as ClientStatus)) {
    filters.status = query.status as ClientStatus;
  }
  if (query.assigned) filters.assigned = query.assigned;
  // El tramo se valida contra el catálogo y no contra una lista suelta: así un
  // tramo nuevo queda filtrable sin tocar esta página.
  if (query.tramo && query.tramo in TRAMO_LABELS) filters.tramo = query.tramo as Tramo;
  if (query.product) filters.product = query.product.slice(0, 120);

  const page = Number.parseInt(query.page ?? "1", 10) || 1;

  const [result, portfolios, operators, products, segments] = await Promise.all([
    getClients(
      session.organization.id,
      session.user.id,
      session.user.role,
      filters,
      page,
    ),
    getPortfolioOptions(session.organization.id),
    getAssignableUsers(session.organization.id),
    getProductOptions(session.organization.id),
    getSegments(session.organization.id),
  ]);

  return (
    <ClientsBoard
      result={result}
      portfolios={portfolios}
      operators={operators}
      products={products}
      segments={segments}
      currency={session.organization.currency}
      // Repartir cartera es de admin y supervisor. El operador ve la pantalla, pero
      // solo su propia cartera y sin poder reasignar.
      canAssign={session.user.role !== "OPERATOR"}
      canSeeScore={isFeatureEnabled("ai_agent", session.organization.plan)}
      tipificaciones={session.organization.tipificaciones}
      cobranza={session.organization.cobranza}
      filters={{
        q: query.q ?? "",
        portfolio: query.portfolio ?? "",
        priority: query.priority ?? "",
        status: query.status ?? "",
        assigned: query.assigned ?? "",
        tramo: query.tramo ?? "",
        product: query.product ?? "",
      }}
    />
  );
}
