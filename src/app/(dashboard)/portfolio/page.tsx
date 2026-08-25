import type { Metadata } from "next";
import Link from "next/link";
import { Banknote, Plus, Upload } from "lucide-react";

import { PortfolioStatusBadge } from "@/components/portfolio/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/auth/session";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Cartera",
};

const SECTOR_LABELS: Record<string, string> = {
  FINANCIAL: "Financiero",
  B2B: "B2B",
  TELECOM: "Telco",
  RETAIL: "Retail",
};

export default async function PortfolioPage() {
  const session = await requireSession();

  const portfolios = await prisma.portfolio.findMany({
    where: { organizationId: session.organization.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      sectorType: true,
      status: true,
      totalClients: true,
      totalAmount: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Carteras</h2>
          <p className="mt-1 text-sm text-pand-gris">
            Importá deudores desde Excel o CSV y mapeá las columnas una sola vez.
          </p>
        </div>

        <div className="flex gap-3">
          <Button asChild variant="outline">
            <Link href="/portfolio/payments">
              <Banknote className="mr-2 h-4 w-4" />
              Importar cobros
            </Link>
          </Button>
          <Button asChild>
            <Link href="/portfolio/new">
              <Plus className="mr-2 h-4 w-4" />
              Nueva cartera
            </Link>
          </Button>
        </div>
      </div>

      {portfolios.length === 0 ? (
        <div className="rounded-card border border-dashed border-pand-border bg-white p-12 text-center">
          <Upload className="mx-auto h-10 w-10 text-pand-gris" />
          <p className="mt-4 font-semibold">Todavía no cargaste ninguna cartera</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-pand-gris">
            Subí tu primer archivo de deudores. El asistente te guía en tres pasos y
            recuerda el mapeo para las próximas cargas.
          </p>
          <Button asChild className="mt-6">
            <Link href="/portfolio/new">Importar deudores</Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card bg-white shadow-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cartera</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Deudores</TableHead>
                <TableHead className="text-right">Monto total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {portfolios.map((portfolio, index) => (
                <TableRow
                  key={portfolio.id}
                  className={index % 2 === 1 ? "bg-pand-bg" : undefined}
                >
                  <TableCell className="font-semibold">{portfolio.name}</TableCell>
                  <TableCell className="text-pand-gris">
                    {portfolio.sectorType
                      ? SECTOR_LABELS[portfolio.sectorType] ?? portfolio.sectorType
                      : "—"}
                  </TableCell>
                  <TableCell className="mono text-sm text-pand-gris">
                    {formatDate(portfolio.createdAt)}
                  </TableCell>
                  <TableCell>
                    <PortfolioStatusBadge status={portfolio.status} />
                  </TableCell>
                  <TableCell className="mono text-right">
                    {formatNumber(portfolio.totalClients)}
                  </TableCell>
                  <TableCell className="mono text-right">
                    {formatCurrency(
                      Number(portfolio.totalAmount),
                      session.organization.currency,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
