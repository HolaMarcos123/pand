"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, MessageCircle, Phone } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { TaskRow } from "@/lib/queries/tasks";
import type { ConfigInteres } from "@/lib/collections/intereses";
import { labelTipo, type Tipificaciones } from "@/lib/config/settings";
import { toWhatsappNumber } from "@/lib/tasks/action-config";
import { cn } from "@/lib/utils";
import type { ClientPriority, Role } from "@/generated/prisma/enums";

import { ClientSheet } from "@/components/clients/client-sheet";

/** Bullet de prioridad. Los colores salen del manual de marca. */
const PRIORITY_DOT: Record<ClientPriority, string> = {
  CRITICAL: "bg-pand-coral",
  HIGH: "bg-[#FFA500]",
  MEDIUM: "bg-pand-celeste",
  LOW: "bg-pand-border",
};

const PRIORITY_LABEL: Record<ClientPriority, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

/**
 * Color de los días de mora: coral arriba de 90, naranja entre 61 y 90, normal más
 * abajo. Es la misma escala que el bullet de prioridad, para que la fila se lea de
 * un vistazo sin cruzar columnas.
 */
function overdueClass(days: number): string {
  if (days > 90) return "text-pand-coral font-semibold";
  if (days >= 61) return "text-[#FFA500] font-semibold";
  return "text-pand-contorno";
}

export function TasksBoard({
  tasks,
  portfolios,
  currency,
  role,
  canSeeScore,
  tipificaciones,
  cobranza,
  canChangeInvoiceStatus,
  filters,
}: {
  tasks: TaskRow[];
  portfolios: { id: string; name: string }[];
  currency: string;
  role: Role;
  canSeeScore: boolean;
  tipificaciones: Tipificaciones;
  cobranza: ConfigInteres;
  canChangeInvoiceStatus: boolean;
  filters: { portfolio: string; priority: string; status: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [focusManagement, setFocusManagement] = useState(false);

  // Filas que ya salieron de la bandeja por una gestión o un cobro. Se sacan al
  // instante y el refresh del servidor confirma; sin esto el operador vuelve a ver
  // por un segundo al cliente que acaba de gestionar y duda de si guardó.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const rows = useMemo(
    () => tasks.filter((task) => !dismissed.has(task.id)),
    [tasks, dismissed],
  );

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.push(`/tasks?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleDone = useCallback(
    (clientId: string, leftInbox: boolean) => {
      if (leftInbox) {
        setDismissed((current) => new Set(current).add(clientId));
        setOpenClientId(null);
      }
      router.refresh();
    },
    [router],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">
            {role === "OPERATOR" ? "Mis tareas de hoy" : "Bandeja del equipo"}
          </h2>
          <p className="mt-1 text-sm text-pand-gris">
            <span className="mono">{formatNumber(rows.length)}</span> deudores
            esperando gestión, del más urgente al menos.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <NativeSelect
            aria-label="Filtrar por cartera"
            className="w-auto"
            value={filters.portfolio}
            onChange={(event) => setFilter("portfolio", event.target.value)}
          >
            <option value="">Todas las carteras</option>
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="Filtrar por prioridad"
            className="w-auto"
            value={filters.priority}
            onChange={(event) => setFilter("priority", event.target.value)}
          >
            <option value="">Toda prioridad</option>
            {(Object.keys(PRIORITY_LABEL) as ClientPriority[]).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </NativeSelect>

          <NativeSelect
            aria-label="Filtrar por estado"
            className="w-auto"
            value={filters.status}
            onChange={(event) => setFilter("status", event.target.value)}
          >
            <option value="">Todo estado</option>
            <option value="PENDING">Pendiente</option>
            <option value="IN_PROGRESS">En gestión</option>
            <option value="PROMISE">Con promesa</option>
            <option value="DISPUTE">En disputa</option>
            <option value="LEGAL">Legal</option>
          </NativeSelect>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-pand-border bg-white p-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-pand-celeste" />
          <p className="mt-4 font-semibold">No queda nada para hoy</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-pand-gris">
            Los deudores con seguimiento agendado vuelven a aparecer cuando llegue su
            fecha.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card bg-white shadow-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Deudor</TableHead>
                <TableHead className="text-right" title="Vencido y lo que vence este mes">
                  Deuda del mes
                </TableHead>
                <TableHead className="text-right">Días mora</TableHead>
                <TableHead>Último contacto</TableHead>
                {role !== "OPERATOR" && <TableHead>Operador</TableHead>}
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((task, index) => (
                <TableRow
                  key={task.id}
                  onClick={() => {
                    setFocusManagement(false);
                    setOpenClientId(task.id);
                  }}
                  className={cn(
                    "cursor-pointer",
                    index % 2 === 1 && "bg-pand-bg",
                  )}
                >
                  <TableCell>
                    <span
                      className={cn(
                        "block h-2.5 w-2.5 rounded-full",
                        PRIORITY_DOT[task.priority],
                      )}
                      title={PRIORITY_LABEL[task.priority]}
                    />
                  </TableCell>

                  <TableCell>
                    <span className="font-semibold">{task.name}</span>
                    {task.documentNumber && (
                      <span className="mono ml-2 text-xs text-pand-gris">
                        {task.documentNumber}
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-right">
                    <span className="mono block">
                      {formatCurrency(task.deudaDelMes, task.moneda)}
                    </span>
                    {/* El total queda abajo y chico: lo que se gestiona hoy es
                        lo vencido y lo que vence este mes, no la deuda entera. */}
                    {task.totalDebt > task.deudaDelMes && (
                      <span className="mono block text-[11px] text-pand-gris">
                        de {formatCurrency(task.totalDebt, task.moneda)}
                      </span>
                    )}
                    {task.monedas > 1 && (
                      <span className="block text-[11px] font-semibold text-pand-azul">
                        + otra moneda
                      </span>
                    )}
                  </TableCell>

                  <TableCell
                    className={cn("mono text-right", overdueClass(task.daysOverdue))}
                  >
                    {formatNumber(task.daysOverdue)}
                  </TableCell>

                  <TableCell className="text-sm text-pand-gris">
                    {task.lastContactAt ? (
                      <>
                        <span className="mono">{task.lastContactAt}</span>
                        {task.lastActionType && (
                          <span className="ml-2">
                            {labelTipo(tipificaciones, task.lastActionType)}
                          </span>
                        )}
                      </>
                    ) : (
                      "Sin contacto"
                    )}
                  </TableCell>

                  {role !== "OPERATOR" && (
                    <TableCell className="text-sm text-pand-gris">
                      {task.assignedToName ?? "Sin asignar"}
                    </TableCell>
                  )}

                  <TableCell>
                    {/* stopPropagation: estos botones no tienen que abrir el panel. */}
                    <div
                      className="flex justify-end gap-1"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <IconLink
                        href={task.phone ? `tel:${task.phone}` : undefined}
                        label="Llamar"
                      >
                        <Phone className="h-4 w-4" />
                      </IconLink>

                      <IconLink
                        href={
                          task.phone
                            ? `https://wa.me/${toWhatsappNumber(task.phone)}`
                            : undefined
                        }
                        label="WhatsApp"
                        external
                      >
                        <MessageCircle className="h-4 w-4" />
                      </IconLink>

                      <button
                        type="button"
                        title="Cargar gestión"
                        onClick={() => {
                          setFocusManagement(true);
                          setOpenClientId(task.id);
                        }}
                        className="rounded-md p-2 text-pand-gris transition-colors hover:bg-pand-bg hover:text-pand-azul"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ClientSheet
        clientId={openClientId}
        currency={currency}
        focusManagement={focusManagement}
        canSeeScore={canSeeScore}
        canChangeInvoiceStatus={canChangeInvoiceStatus}
        tipificaciones={tipificaciones}
        cobranza={cobranza}
        onClose={() => setOpenClientId(null)}
        onDone={handleDone}
      />
    </div>
  );
}

/** Botón de contacto. Deshabilitado y explicado cuando falta el teléfono. */
function IconLink({
  href,
  label,
  external = false,
  children,
}: {
  href?: string;
  label: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  if (!href) {
    return (
      <span
        title={`${label}: el deudor no tiene teléfono cargado`}
        className="cursor-not-allowed rounded-md p-2 text-pand-border"
      >
        {children}
      </span>
    );
  }

  return (
    <a
      href={href}
      title={label}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="rounded-md p-2 text-pand-gris transition-colors hover:bg-pand-bg hover:text-pand-azul"
    >
      {children}
    </a>
  );
}
