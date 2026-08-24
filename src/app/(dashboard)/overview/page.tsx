import type { Metadata } from "next";

import { requireSession } from "@/lib/auth/session";
import { PLAN_LABELS } from "@/lib/feature-flags";

export const metadata: Metadata = {
  title: "Overview",
};

/**
 * Placeholder. Los KPIs, los gráficos de Recharts y la tabla de operadores son el
 * P03; esto existe para que el flujo de auth tenga a dónde aterrizar.
 */
export default async function OverviewPage() {
  const session = await requireSession();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Hola, {session.user.fullName.split(" ")[0]}
      </h1>
      <p className="mt-2 text-pand-gris">
        {session.organization.name} · plan {PLAN_LABELS[session.organization.plan]}
      </p>

      <div className="mt-8 rounded-xl border border-pand-border bg-white p-6">
        <p className="text-sm text-pand-gris">
          El dashboard de KPIs se construye en el paso P03.
        </p>
      </div>
    </main>
  );
}
