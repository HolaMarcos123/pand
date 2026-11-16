import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";

import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { getPlatformSession } from "@/lib/platform/access";
import { getPlatformTotals, listTenants } from "@/lib/platform/queries";

import { TenantsTable } from "./tenants-table";

export const metadata: Metadata = {
  title: "Backoffice",
};

export default async function BackofficePage() {
  // El corte va antes de consultar. Estas consultas NO filtran por organización
  // —son las únicas del producto que miran todas a la vez—, así que su resultado
  // en el payload de RSC sería la lista completa de clientes de Pand.
  const session = await getPlatformSession();
  if (!session) notFound();

  const [tenants, totales] = await Promise.all([listTenants(), getPlatformTotals()]);

  const kpis = [
    { label: "Empresas", valor: formatNumber(totales.organizaciones) },
    { label: "Suspendidas", valor: formatNumber(totales.suspendidas) },
    { label: "Usuarios activos", valor: formatNumber(totales.usuarios) },
    { label: "Deudores", valor: formatNumber(totales.deudores) },
    {
      label: "Cartera bajo gestión",
      valor: formatCurrency(totales.carteraAbierta, "PYG"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Empresas clientes</h1>
          <p className="mt-1 text-sm text-pand-gris">
            Alta, plan, límites y consumo de cada cuenta.
          </p>
        </div>

        <Link
          href="/backoffice/nueva"
          className="flex items-center gap-2 rounded-lg bg-pand-azul px-4 py-2 text-sm font-semibold text-white hover:bg-pand-azul/90"
        >
          <Plus className="h-4 w-4" />
          Dar de alta una empresa
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-card bg-white/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-pand-gris">
              {kpi.label}
            </p>
            <p className="mono mt-2 text-lg font-medium text-white">{kpi.valor}</p>
          </div>
        ))}
      </section>

      {/* La cartera total se muestra en guaraníes, que es lo que usan todas las
          cuentas hoy. Cuando haya clientes en otra moneda hay que sumarlas por
          separado: convertir sin un tipo de cambio sería inventar un número. */}
      <p className="text-xs text-pand-gris">
        La cartera bajo gestión suma los saldos abiertos de todas las empresas, en
        guaraníes.{" "}
        {formatDate(new Date())}
      </p>

      <TenantsTable tenants={tenants} propiaId={session.organization.id} />
    </div>
  );
}
