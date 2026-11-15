import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/session";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  getPortfolioOptions,
  getTasks,
  type TaskFilters,
} from "@/lib/queries/tasks";
import type { ClientPriority, ClientStatus } from "@/generated/prisma/enums";

import { TasksBoard } from "./tasks-board";

export const metadata: Metadata = {
  title: "Tareas",
};

const PRIORITIES: ClientPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const STATUSES: ClientStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "PROMISE",
  "DISPUTE",
  "LEGAL",
];

/** Los filtros llegan por querystring: así el estado de la bandeja es compartible. */
function parseFilters(params: Record<string, string | undefined>): TaskFilters {
  const filters: TaskFilters = {};

  if (params.portfolio) filters.portfolioId = params.portfolio;
  if (params.priority && PRIORITIES.includes(params.priority as ClientPriority)) {
    filters.priority = params.priority as ClientPriority;
  }
  if (params.status && STATUSES.includes(params.status as ClientStatus)) {
    filters.status = params.status as ClientStatus;
  }

  return filters;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [session, query] = await Promise.all([requireSession(), searchParams]);
  const filters = parseFilters(query);

  const [tasks, portfolios] = await Promise.all([
    getTasks(
      session.organization.id,
      session.user.id,
      session.user.role,
      filters,
    ),
    getPortfolioOptions(session.organization.id),
  ]);

  return (
    <TasksBoard
      tasks={tasks}
      portfolios={portfolios}
      currency={session.organization.currency}
      role={session.user.role}
      // El plan se resuelve en el servidor: el panel es un Client Component y no
      // puede usar <PlanGuard>, que es servidor.
      canSeeScore={isFeatureEnabled("ai_agent", session.organization.plan)}
      filters={{
        portfolio: query.portfolio ?? "",
        priority: query.priority ?? "",
        status: query.status ?? "",
      }}
    />
  );
}
