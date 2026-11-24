"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  Shuffle,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useState, useTransition } from "react";
import { toast } from "sonner";

import { ClientSheet } from "@/components/clients/client-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  assignClients,
  deleteSegment,
  distributeClients,
  saveSegment,
} from "@/lib/clients/actions";
import { TRAMOS_ACTIVOS, TRAMO_LABELS } from "@/lib/collections/tramos";
import type { ConfigInteres } from "@/lib/collections/intereses";
import type { Tipificaciones } from "@/lib/config/settings";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ClientListResult, SegmentRow } from "@/lib/queries/clients";
import { cn } from "@/lib/utils";
import type { ClientPriority, ClientStatus } from "@/generated/prisma/enums";

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

const STATUS_LABEL: Record<ClientStatus, string> = {
  PENDING: "Pendiente",
  IN_PROGRESS: "En gestión",
  PROMISE: "Con promesa",
  PAID: "Pagado",
  DISPUTE: "En disputa",
  LEGAL: "Legal",
  LOST: "Perdido",
};

function overdueClass(days: number): string {
  if (days > 90) return "text-pand-coral font-semibold";
  if (days >= 61) return "text-[#FFA500] font-semibold";
  return "text-pand-contorno";
}

export function ClientsBoard({
  result,
  portfolios,
  operators,
  products,
  monedas,
  segments,
  currency,
  canAssign,
  canSeeScore,
  tipificaciones,
  cobranza,
  filters,
}: {
  result: ClientListResult;
  portfolios: { id: string; name: string }[];
  operators: { id: string; fullName: string; role: string }[];
  products: string[];
  /** Las monedas con deuda abierta, para el filtro. */
  monedas: string[];
  segments: SegmentRow[];
  currency: string;
  canAssign: boolean;
  canSeeScore: boolean;
  tipificaciones: Tipificaciones;
  cobranza: ConfigInteres;
  filters: {
    q: string;
    portfolio: string;
    priority: string;
    status: string;
    assigned: string;
    tramo: string;
    product: string;
    currency: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<string>("");
  const [saving, startSaving] = useTransition();
  const [query, setQuery] = useState(filters.q);
  const [segmentName, setSegmentName] = useState("");
  const [savingSegment, setSavingSegment] = useState(false);

  // Un segmento es el conjunto de filtros activos. Si no hay ninguno, no hay nada
  // que guardar: sería un atajo a la lista completa.
  const hayFiltros = Object.entries(filters).some(
    ([key, value]) => key !== "q" ? Boolean(value) : Boolean(value.trim()),
  );

  function aplicarSegmento(segment: SegmentRow) {
    const params = new URLSearchParams(segment.filters);
    router.push(`/clients?${params.toString()}`);
  }

  function guardarSegmento() {
    const name = segmentName.trim();
    if (!name) return;

    setSavingSegment(true);
    startSaving(async () => {
      const outcome = await saveSegment({ name, filters });
      setSavingSegment(false);

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setSegmentName("");
      toast.success(`Segmento «${name}» guardado.`);
      router.refresh();
    });
  }

  function borrarSegmento(segment: SegmentRow) {
    startSaving(async () => {
      const outcome = await deleteSegment(segment.id);
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success(`Segmento «${segment.name}» borrado.`);
      router.refresh();
    });
  }

  const allOnPageSelected =
    result.rows.length > 0 && result.rows.every((r) => selected.has(r.id));

  const setParam = useCallback(
    (changes: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      // Cualquier cambio de filtro vuelve a la primera página: quedarse en la 7 de un
      // resultado que ahora tiene 2 muestra una tabla vacía sin explicación.
      if (!("page" in changes)) params.delete("page");
      router.push(`/clients?${params.toString()}`);
    },
    [router, searchParams],
  );

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) result.rows.forEach((r) => next.delete(r.id));
      else result.rows.forEach((r) => next.add(r.id));
      return next;
    });
  }

  function runAssign(operatorId: string | null) {
    const ids = Array.from(selected);
    if (!ids.length) return;

    startSaving(async () => {
      const outcome = await assignClients({ clientIds: ids, operatorId });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success(
        operatorId
          ? `${formatNumber(outcome.assigned)} deudores asignados.`
          : `${formatNumber(outcome.assigned)} deudores sin asignar.`,
      );
      setSelected(new Set());
      router.refresh();
    });
  }

  function runDistribute() {
    const ids = operators.map((o) => o.id);
    if (!ids.length) {
      toast.error("No hay operadores activos para repartir.");
      return;
    }

    startSaving(async () => {
      const outcome = await distributeClients({
        operatorIds: ids,
        portfolioId: filters.portfolio || null,
        includeAssigned: false,
      });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success(
        `${formatNumber(outcome.assigned)} deudores repartidos entre ${ids.length} operadores.`,
      );
      router.refresh();
    });
  }

  const rangeFrom = (result.page - 1) * 25 + 1;
  const rangeTo = Math.min(result.page * 25, result.total);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Clientes</h2>
          <p className="mt-1 text-sm text-pand-gris">
            <span className="mono">{formatNumber(result.total)}</span> deudores
            {result.unassigned > 0 && canAssign && (
              <>
                {" · "}
                <span className="mono font-semibold text-pand-coral">
                  {formatNumber(result.unassigned)} sin asignar
                </span>
              </>
            )}
          </p>
        </div>

        {canAssign && result.unassigned > 0 && (
          <Button onClick={runDistribute} disabled={saving} variant="outline">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Shuffle className="mr-2 h-4 w-4" />
            )}
            Repartir sin asignar
          </Button>
        )}
      </div>

      {/* ── Segmentos ──────────────────────────────────────── */}
      {(segments.length > 0 || (canAssign && hayFiltros)) && (
        <div className="flex flex-wrap items-center gap-2">
          <Bookmark className="h-4 w-4 shrink-0 text-pand-gris" />

          {segments.map((segment) => (
            <span
              key={segment.id}
              className="group flex items-center rounded-badge border border-pand-border bg-white"
            >
              <button
                type="button"
                onClick={() => aplicarSegmento(segment)}
                className="px-3 py-1.5 text-xs font-semibold text-pand-contorno hover:text-pand-azul"
              >
                {segment.name}
              </button>
              {canAssign && (
                <button
                  type="button"
                  aria-label={`Borrar segmento ${segment.name}`}
                  disabled={saving}
                  onClick={() => borrarSegmento(segment)}
                  className="pr-2 text-pand-gris opacity-0 transition-opacity hover:text-pand-coral group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}

          {canAssign && hayFiltros && (
            <span className="flex items-center gap-1.5">
              <Input
                value={segmentName}
                onChange={(event) => setSegmentName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    guardarSegmento();
                  }
                }}
                placeholder="Guardar estos filtros como…"
                className="h-8 w-[220px] text-xs"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                disabled={!segmentName.trim() || savingSegment}
                onClick={guardarSegmento}
              >
                Guardar
              </Button>
            </span>
          )}
        </div>
      )}

      {/* ── Búsqueda y filtros ─────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setParam({ q: query.trim() });
          }}
          className="relative min-w-[240px] flex-1"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-pand-gris" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, documento o ID…"
            className="pl-9"
          />
        </form>

        <NativeSelect
          aria-label="Cartera"
          className="w-auto"
          value={filters.portfolio}
          onChange={(event) => setParam({ portfolio: event.target.value })}
        >
          <option value="">Todas las carteras</option>
          {portfolios.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Prioridad"
          className="w-auto"
          value={filters.priority}
          onChange={(event) => setParam({ priority: event.target.value })}
        >
          <option value="">Toda prioridad</option>
          {(Object.keys(PRIORITY_LABEL) as ClientPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Estado"
          className="w-auto"
          value={filters.status}
          onChange={(event) => setParam({ status: event.target.value })}
        >
          <option value="">Todo estado</option>
          {(Object.keys(STATUS_LABEL) as ClientStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Tramo de mora"
          className="w-auto"
          value={filters.tramo}
          onChange={(event) => setParam({ tramo: event.target.value })}
        >
          <option value="">Todo tramo</option>
          {TRAMOS_ACTIVOS.map((t) => (
            <option key={t} value={t}>
              {TRAMO_LABELS[t]}
            </option>
          ))}
          {/* Castigo va aparte: no es cartera activa, pero se tiene que poder mirar. */}
          <option value="CASTIGO">{TRAMO_LABELS.CASTIGO}</option>
        </NativeSelect>

        {/* Solo si la cartera mezcla monedas: con una sola, el filtro no
            filtra nada y ocupa lugar en una barra que ya tiene seis. */}
        {monedas.length > 1 && (
          <NativeSelect
            aria-label="Moneda"
            className="w-auto"
            value={filters.currency}
            onChange={(event) => setParam({ currency: event.target.value })}
          >
            <option value="">Toda moneda</option>
            {monedas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        )}

        {products.length > 0 && (
          <NativeSelect
            aria-label="Producto"
            className="w-auto"
            value={filters.product}
            onChange={(event) => setParam({ product: event.target.value })}
          >
            <option value="">Todo producto</option>
            {products.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        )}

        {canAssign && (
          <NativeSelect
            aria-label="Operador"
            className="w-auto"
            value={filters.assigned}
            onChange={(event) => setParam({ assigned: event.target.value })}
          >
            <option value="">Todos los operadores</option>
            <option value="unassigned">Sin asignar</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      {/* ── Barra de acción masiva ─────────────────────────── */}
      {canAssign && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border border-pand-celeste bg-pand-celeste/10 px-4 py-3">
          <span className="mono text-sm font-semibold">
            {formatNumber(selected.size)} seleccionados
          </span>

          <NativeSelect
            aria-label="Asignar a"
            className="w-auto"
            value={assignTo}
            onChange={(event) => setAssignTo(event.target.value)}
          >
            <option value="">Asignar a…</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>
                {o.fullName}
              </option>
            ))}
          </NativeSelect>

          <Button
            size="sm"
            disabled={!assignTo || saving}
            onClick={() => runAssign(assignTo)}
          >
            <UserPlus className="mr-2 h-4 w-4" />
            Asignar
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => runAssign(null)}
          >
            Quitar asignación
          </Button>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-pand-gris hover:underline"
          >
            Limpiar
          </button>
        </div>
      )}

      {/* ── Tabla ──────────────────────────────────────────── */}
      {result.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-pand-border bg-white p-12 text-center">
          <p className="font-semibold">No hay deudores con esos filtros</p>
          <p className="mt-1 text-sm text-pand-gris">
            Probá limpiar la búsqueda o cambiar los filtros.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card bg-white shadow-panel">
          <Table>
            <TableHeader>
              <TableRow>
                {canAssign && (
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar toda la página"
                      checked={allOnPageSelected}
                      onChange={toggleAllOnPage}
                      className="h-4 w-4 rounded border-pand-border"
                    />
                  </TableHead>
                )}
                <TableHead className="w-8" />
                <TableHead>Deudor</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Cartera</TableHead>
                <TableHead className="text-right" title="Vencido y lo que vence este mes">
                  Deuda del mes
                </TableHead>
                <TableHead>Tramo</TableHead>
                <TableHead className="text-right">Días mora</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Operador</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {result.rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  onClick={() => setOpenClientId(row.id)}
                  className={cn("cursor-pointer", index % 2 === 1 && "bg-pand-bg")}
                >
                  {canAssign && (
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${row.name}`}
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        className="h-4 w-4 rounded border-pand-border"
                      />
                    </TableCell>
                  )}

                  <TableCell>
                    <span
                      className={cn(
                        "block h-2.5 w-2.5 rounded-full",
                        PRIORITY_DOT[row.priority],
                      )}
                      title={PRIORITY_LABEL[row.priority]}
                    />
                  </TableCell>

                  <TableCell>
                    <span className="font-semibold">{row.name}</span>
                    {row.documentNumber && (
                      <span className="mono ml-2 text-xs text-pand-gris">
                        {row.documentNumber}
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="max-w-[160px] truncate text-sm">
                    {row.products ?? <span className="text-pand-gris">—</span>}
                  </TableCell>

                  <TableCell className="text-sm text-pand-gris">
                    {row.portfolioName ?? "—"}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-right">
                    <span className="mono block">
                      {formatCurrency(row.deudaDelMes, row.moneda)}
                    </span>
                    {/* El total queda abajo y chico: lo que se gestiona hoy es
                        lo vencido y lo que vence este mes, no la deuda entera. */}
                    {row.totalDebt > row.deudaDelMes && (
                      <span className="mono block text-[11px] text-pand-gris">
                        de {formatCurrency(row.totalDebt, row.moneda)}
                      </span>
                    )}
                    {row.monedas > 1 && (
                      <span className="block text-[11px] font-semibold text-pand-azul">
                        + otra moneda
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <span
                      className={cn(
                        "whitespace-nowrap text-xs font-semibold",
                        row.tramo === "CASTIGO" || row.tramo === "LEGAL"
                          ? "text-pand-coral"
                          : "text-pand-gris",
                      )}
                    >
                      {TRAMO_LABELS[row.tramo]}
                    </span>
                  </TableCell>

                  <TableCell
                    className={cn("mono text-right", overdueClass(row.daysOverdue))}
                  >
                    {formatNumber(row.daysOverdue)}
                  </TableCell>

                  <TableCell>
                    <Badge className="bg-pand-bg text-pand-gris hover:bg-pand-bg">
                      {STATUS_LABEL[row.status]}
                    </Badge>
                  </TableCell>

                  <TableCell className="text-sm">
                    {row.assignedToName ?? (
                      <span className="text-pand-coral">Sin asignar</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Paginación ─────────────────────────────────────── */}
      {result.total > 0 && (
        <div className="flex items-center justify-between">
          <p className="mono text-xs text-pand-gris">
            {formatNumber(rangeFrom)}–{formatNumber(rangeTo)} de{" "}
            {formatNumber(result.total)}
          </p>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={result.page <= 1}
              onClick={() => setParam({ page: String(result.page - 1) })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="mono text-xs text-pand-gris">
              {result.page} / {result.pages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={result.page >= result.pages}
              onClick={() => setParam({ page: String(result.page + 1) })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <ClientSheet
        clientId={openClientId}
        currency={currency}
        focusManagement={false}
        canSeeScore={canSeeScore}
        canChangeInvoiceStatus={canAssign}
        tipificaciones={tipificaciones}
        cobranza={cobranza}
        onClose={() => setOpenClientId(null)}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
