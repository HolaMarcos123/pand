import type { Metadata } from "next";
import Link from "next/link";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/auth/session";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  safePercent,
} from "@/lib/format";
import { paymentMethodLabel } from "@/lib/import/payment-config";
import {
  PROMISE_STATE_LABELS,
  getContactability,
  getPromises,
  getRecovery,
  parsePeriod,
  todayInParaguay,
  type Period,
} from "@/lib/queries/reports";
import { labelTipo } from "@/lib/config/settings";

export const metadata: Metadata = {
  title: "Reportes",
};

/** Atajos de período. Se resuelven en el server, así que no hace falta JS. */
function presets(): { label: string; period: Period }[] {
  const today = todayInParaguay();
  const [year, month] = today.split("-").map(Number);

  const pad = (n: number) => String(n).padStart(2, "0");
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  // Día 0 del mes siguiente = último día del mes anterior, sin tabla de 30/31.
  const lastDayPrev = new Date(Date.UTC(prevYear, prevMonth, 0))
    .toISOString()
    .slice(0, 10);

  const thirtyAgo = new Date(`${today}T00:00:00Z`);
  thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 29);

  return [
    { label: "Mes actual", period: { from: `${year}-${pad(month)}-01`, to: today } },
    {
      label: "Mes anterior",
      period: { from: `${prevYear}-${pad(prevMonth)}-01`, to: lastDayPrev },
    },
    {
      label: "Últimos 30 días",
      period: { from: thirtyAgo.toISOString().slice(0, 10), to: today },
    },
  ];
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await requireSession();

  // El corte va ANTES de consultar, no solo en el menú. El layout y la página se
  // renderizan en paralelo: si la página consulta y después alguien decide no
  // mostrarla, los datos ya viajaron al browser dentro del payload de RSC.
  if (session.user.role === "OPERATOR") {
    return (
      <Forbidden
        organizationName={session.organization.name}
        reason="Los reportes son de la cartera completa, no de una bandeja. Están reservados a Supervisor y Administrador."
      />
    );
  }

  const period = parsePeriod(await searchParams);
  const organizationId = session.organization.id;
  const currency = session.organization.currency;

  const [recovery, channels, promises] = await Promise.all([
    getRecovery(organizationId, period),
    getContactability(organizationId, period),
    getPromises(organizationId, period),
  ]);

  const totalAttempts = channels.reduce((sum, row) => sum + row.attempts, 0);
  const totalContacts = channels.reduce((sum, row) => sum + row.contacts, 0);
  const brokenRow = promises.byState.find((row) => row.state === "ROTA");

  return (
    <div className="space-y-8">
      {/* ── Período ───────────────────────────────────────── */}
      <section className="rounded-card bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="from">Desde</Label>
              <Input
                id="from"
                name="from"
                type="date"
                defaultValue={period.from}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Hasta</Label>
              <Input
                id="to"
                name="to"
                type="date"
                defaultValue={period.to}
                className="w-[160px]"
              />
            </div>
            <Button type="submit">Aplicar</Button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            {presets().map((preset) => {
              const activo =
                preset.period.from === period.from && preset.period.to === period.to;

              return (
                <Link
                  key={preset.label}
                  href={`/reports?from=${preset.period.from}&to=${preset.period.to}`}
                  className={
                    activo
                      ? "rounded-badge bg-pand-azul px-3 py-1.5 text-xs font-semibold text-white"
                      : "rounded-badge border border-pand-border px-3 py-1.5 text-xs font-semibold text-pand-gris hover:text-pand-contorno"
                  }
                >
                  {preset.label}
                </Link>
              );
            })}
          </div>
        </div>

        <p className="mt-3 text-xs text-pand-gris">
          Todo lo de abajo mira el mismo período:{" "}
          <span className="mono">{formatDate(period.from)}</span> a{" "}
          <span className="mono">{formatDate(period.to)}</span>. Las fechas se leen en
          hora de Paraguay.
        </p>
      </section>

      {/* ── 1. Recupero del período ───────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-lg font-bold">Recupero del período</h2>

        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            label="Cobrado"
            value={formatCurrency(recovery.collected, currency)}
            hint={`${formatNumber(recovery.payers)} deudores pagaron`}
          />
          <KpiCard
            label="Cobros registrados"
            value={formatNumber(recovery.paymentsCount)}
            hint="Pagos imputados en el período"
          />
          <KpiCard
            label="Ticket promedio"
            value={formatCurrency(recovery.averageTicket, currency)}
            hint="Cobrado sobre cantidad de cobros"
          />
        </div>

        <div className="rounded-card bg-white shadow-card">
          <div className="border-b border-pand-border px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
              Recupero por medio de pago
            </p>
          </div>

          {recovery.byMethod.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-pand-gris">
              No hay cobros registrados en este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medio</TableHead>
                    <TableHead className="text-right">Cobros</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">% del total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recovery.byMethod.map((row, index) => (
                    <TableRow
                      key={row.method}
                      className={index % 2 === 1 ? "bg-pand-bg" : undefined}
                    >
                      <TableCell className="font-semibold">
                        {paymentMethodLabel(row.method)}
                      </TableCell>
                      <TableCell className="mono text-right">
                        {formatNumber(row.count)}
                      </TableCell>
                      <TableCell className="mono text-right">
                        {formatCurrency(row.amount, currency)}
                      </TableCell>
                      <TableCell className="mono text-right text-pand-gris">
                        {formatPercent(
                          safePercent(row.amount, recovery.collected),
                          0,
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      {/* ── 2. Contactabilidad por canal ──────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Contactabilidad por canal</h2>
          <p className="mt-1 text-sm text-pand-gris">
            Cuenta como contacto la gestión donde hubo alguien del otro lado: promete,
            se niega, ya pagó o pide que lo llamen. «No atiende», «ocupado» y «número
            equivocado» son intentos.
          </p>
        </div>

        <div className="rounded-card bg-white shadow-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Gestiones</TableHead>
                  <TableHead className="text-right">Contactos</TableHead>
                  <TableHead className="text-right">Contactabilidad</TableHead>
                  <TableHead className="text-right">Promesas</TableHead>
                  <TableHead className="text-right">Prometido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((row, index) => (
                  <TableRow
                    key={row.channel}
                    className={index % 2 === 1 ? "bg-pand-bg" : undefined}
                  >
                    <TableCell className="font-semibold">
                      {labelTipo(session.organization.tipificaciones, row.channel)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(row.attempts)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(row.contacts)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {row.attempts === 0 ? (
                        <span className="text-pand-gris">—</span>
                      ) : (
                        formatPercent(row.contactRate, 0)
                      )}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(row.promises)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatCurrency(row.promisedAmount, currency)}
                    </TableCell>
                  </TableRow>
                ))}

                <TableRow className="border-t-2 border-pand-border">
                  <TableCell className="font-bold">Total</TableCell>
                  <TableCell className="mono text-right font-bold">
                    {formatNumber(totalAttempts)}
                  </TableCell>
                  <TableCell className="mono text-right font-bold">
                    {formatNumber(totalContacts)}
                  </TableCell>
                  <TableCell className="mono text-right font-bold">
                    {totalAttempts === 0
                      ? "—"
                      : formatPercent(safePercent(totalContacts, totalAttempts), 0)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* ── 3. Cumplimiento de promesas ───────────────────── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Cumplimiento de promesas</h2>
          <p className="mt-1 text-sm text-pand-gris">
            Promesas que <strong>vencen</strong> en el período. Una promesa se da por
            cumplida si el deudor pagó el monto prometido hasta 3 días después de la
            fecha: un pago acreditado el lunes por una promesa del viernes llegó
            tarde, no se incumplió.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <KpiCard
            label="Prometido"
            value={formatCurrency(promises.totalPromised, currency)}
            hint={`${formatNumber(
              promises.byState.reduce((sum, row) => sum + row.count, 0),
            )} promesas con vencimiento en el período`}
          />
          {/* Único KPI en celeste de la pantalla: es el número que dispara acción. */}
          <KpiCard
            critical
            label="Cumplimiento"
            value={formatPercent(promises.complianceRate)}
            hint="Cobrado sobre prometido, solo promesas ya vencidas. Cada promesa cuenta hasta su monto: un sobrepago no tapa una rota."
          />
          <KpiCard
            label="Rotas"
            value={formatNumber(brokenRow?.count ?? 0)}
            hint={`${formatCurrency(brokenRow?.promised ?? 0, currency)} sin entrar`}
          />
        </div>

        <div className="rounded-card bg-white shadow-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Promesas</TableHead>
                  <TableHead className="text-right">Prometido</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                </TableRow>
                {/* "Cobrado" va topeado en lo prometido: ver honored. */}
              </TableHeader>
              <TableBody>
                {promises.byState.map((row, index) => (
                  <TableRow
                    key={row.state}
                    className={index % 2 === 1 ? "bg-pand-bg" : undefined}
                  >
                    <TableCell className="font-semibold">
                      {PROMISE_STATE_LABELS[row.state]}
                      {row.state === "VIGENTE" && (
                        <span className="ml-2 text-xs font-normal text-pand-gris">
                          todavía no se les venció el plazo
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatNumber(row.count)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatCurrency(row.promised, currency)}
                    </TableCell>
                    <TableCell className="mono text-right">
                      {formatCurrency(row.honored, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Top de rotas: la lista de llamadas del supervisor para mañana. */}
        <div className="rounded-card bg-white shadow-card">
          <div className="border-b border-pand-border px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
              Promesas incumplidas, por lo que falta entrar
            </p>
          </div>

          {promises.broken.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-pand-gris">
              Ninguna promesa vencida quedó sin cumplir en este período.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deudor</TableHead>
                    <TableHead>Teléfono</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Prometió para</TableHead>
                    <TableHead className="text-right">Atraso</TableHead>
                    <TableHead className="text-right">Prometido</TableHead>
                    <TableHead className="text-right">Pagó</TableHead>
                    <TableHead className="text-right">Falta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {promises.broken.map((row, index) => (
                    <TableRow
                      key={row.id}
                      className={index % 2 === 1 ? "bg-pand-bg" : undefined}
                    >
                      <TableCell className="font-semibold">
                        {row.clientName}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap text-xs">
                        {row.phone ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-pand-gris">
                        {row.operatorName ?? "—"}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap text-xs">
                        {formatDate(row.promiseDate)}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap text-right text-pand-coral">
                        {row.daysLate > 0 ? `${formatNumber(row.daysLate)} d` : "—"}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap text-right">
                        {formatCurrency(row.promised, currency)}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap text-right text-pand-gris">
                        {formatCurrency(row.paid, currency)}
                      </TableCell>
                      <TableCell className="mono whitespace-nowrap text-right font-semibold">
                        {formatCurrency(row.promised - row.paid, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
