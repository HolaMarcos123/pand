import type { Metadata } from "next";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrancheChart } from "@/components/dashboard/tranche-chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/auth/session";
import { formatCurrency, formatNumber, formatPercent, safePercent } from "@/lib/format";
import { getKpis, getOperatorStats, getTranches } from "@/lib/queries/dashboard";

export const metadata: Metadata = {
  title: "Overview",
};

export default async function OverviewPage() {
  const session = await requireSession();
  const organizationId = session.organization.id;

  // Las tres consultas son independientes: en serie sumarían tres viajes a São Paulo.
  const [kpis, tranches, operators] = await Promise.all([
    getKpis(organizationId),
    getTranches(organizationId),
    getOperatorStats(organizationId),
  ]);

  const currency = session.organization.currency;

  return (
    <div className="space-y-6">
      {/* Fila 1 — tres KPI por fila como máximo, regla del manual. */}
      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard
          label="Recupero mes"
          value={formatCurrency(kpis.recoveredAmount, currency)}
          hint={`${formatPercent(kpis.recoveryRate)} de la cartera del período`}
        />
        <KpiCard
          label="Compromisos"
          value={formatCurrency(kpis.promisedAmount, currency)}
          hint={`${formatNumber(kpis.promisesCount)} promesas vigentes`}
        />
        {/* El indicador crítico va sobre celeste. Solo este. */}
        <KpiCard
          critical
          label="Mora +90"
          value={formatCurrency(kpis.overdue90Amount, currency)}
          hint={`${formatPercent(kpis.overdue90Rate)} de la cartera abierta`}
        />
      </section>

      {/* Fila 2 — cartera por tramo */}
      <section>
        <TrancheChart
          data={tranches}
          currency={currency}
          writtenOff={kpis.writtenOffAmount}
        />
      </section>

      {/* Fila 3 — operadores del mes */}
      <section className="rounded-card bg-white shadow-card">
        <div className="border-b border-pand-border px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
            Operadores del mes
          </p>
        </div>

        {operators.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-pand-gris">
            Todavía no hay operadores activos en la organización.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operador</TableHead>
                  <TableHead className="text-right">Clientes</TableHead>
                  <TableHead className="text-right">Contactos</TableHead>
                  <TableHead className="text-right">Compromisos</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                  <TableHead className="text-right">%</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operators.map((operator, index) => (
                  <TableRow
                    key={operator.id}
                    // Zebra del manual: alterna bg-pand-bg y blanco.
                    className={index % 2 === 1 ? "bg-pand-bg" : undefined}
                  >
                    <TableCell className="font-semibold">
                      {operator.fullName}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(operator.clients)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(operator.contacts)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(operator.promises)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatCurrency(operator.collected, currency)}
                    </TableCell>
                    <TableCell className="mono text-right text-pand-gris">
                      {formatPercent(
                        safePercent(operator.collected, kpis.recoveredAmount),
                        0,
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
