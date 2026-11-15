import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  getAssignableUsers,
  getClients,
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

  const page = Number.parseInt(query.page ?? "1", 10) || 1;

  const [result, portfolios, operators] = await Promise.all([
    getClients(
      session.organization.id,
      session.user.id,
      session.user.role,
      filters,
      page,
    ),
    getPortfolioOptions(session.organization.id),
    getAssignableUsers(session.organization.id),
  ]);

  return (
    <ClientsBoard
      result={result}
      portfolios={portfolios}
      operators={operators}
      currency={session.organization.currency}
      // Repartir cartera es de admin y supervisor. El operador ve la pantalla, pero
      // solo su propia cartera y sin poder reasignar.
      canAssign={session.user.role !== "OPERATOR"}
      canSeeScore={isFeatureEnabled("ai_agent", session.organization.plan)}
      filters={{
        q: query.q ?? "",
        portfolio: query.portfolio ?? "",
        priority: query.priority ?? "",
        status: query.status ?? "",
        assigned: query.assigned ?? "",
      }}
    />
  );
}
