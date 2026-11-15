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
  searchParams: Record<string, string | undefined>;
}) {
  const session = await requireSession();

  const filters: ClientFilters = {};
  if (searchParams.q) filters.q = searchParams.q.slice(0, 80);
  if (searchParams.portfolio) filters.portfolioId = searchParams.portfolio;
  if (PRIORITIES.includes(searchParams.priority as ClientPriority)) {
    filters.priority = searchParams.priority as ClientPriority;
  }
  if (STATUSES.includes(searchParams.status as ClientStatus)) {
    filters.status = searchParams.status as ClientStatus;
  }
  if (searchParams.assigned) filters.assigned = searchParams.assigned;

  const page = Number.parseInt(searchParams.page ?? "1", 10) || 1;

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
        q: searchParams.q ?? "",
        portfolio: searchParams.portfolio ?? "",
        priority: searchParams.priority ?? "",
        status: searchParams.status ?? "",
        assigned: searchParams.assigned ?? "",
      }}
    />
  );
}
