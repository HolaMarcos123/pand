"use client";

import {
  Banknote,
  Loader2,
  MessageCircle,
  Phone,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_TONE,
  MANUAL_INVOICE_STATUSES,
  esCarteraActiva,
  type ManualInvoiceStatus,
} from "@/lib/collections/invoice-status";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { ClientDetail } from "@/lib/queries/tasks";
import {
  labelResultado,
  labelTipo,
  resultadosDe,
  tiposCargables,
  type Tipificaciones,
} from "@/lib/config/settings";
import { toWhatsappNumber } from "@/lib/tasks/action-config";
import {
  loadClientDetail,
  saveManagementAction,
  setInvoiceStatus,
} from "@/lib/tasks/actions";
import { cn } from "@/lib/utils";
import type {
  ActionResult,
  ActionType,
  ClientPriority,
  InvoiceStatus,
} from "@/generated/prisma/enums";

import { PaymentDialog } from "./payment-dialog";

const PRIORITY_BADGE: Record<ClientPriority, string> = {
  CRITICAL: "bg-pand-coral text-white hover:bg-pand-coral",
  HIGH: "bg-[#FFA500] text-white hover:bg-[#FFA500]",
  MEDIUM: "bg-pand-celeste text-pand-contorno hover:bg-pand-celeste",
  LOW: "bg-pand-border text-pand-gris hover:bg-pand-border",
};

const PRIORITY_LABEL: Record<ClientPriority, string> = {
  CRITICAL: "Crítica",
  HIGH: "Alta",
  MEDIUM: "Media",
  LOW: "Baja",
};

const today = () => new Date().toISOString().slice(0, 10);

export function ClientSheet({
  clientId,
  currency,
  focusManagement,
  canSeeScore,
  canChangeInvoiceStatus,
  tipificaciones,
  onClose,
  onDone,
}: {
  clientId: string | null;
  currency: string;
  focusManagement: boolean;
  canSeeScore: boolean;
  /** Refinanciar y castigar saca deuda de la cartera: no es del operador. */
  canChangeInvoiceStatus: boolean;
  /** Cómo llama esta organización a cada gestión y a cada resultado. */
  tipificaciones: Tipificaciones;
  onClose: () => void;
  onDone: (clientId: string, leftInbox: boolean) => void;
}) {
  const [detail, setDetail] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, startSaving] = useTransition();
  const [payOpen, setPayOpen] = useState(false);
  const [changingInvoice, setChangingInvoice] = useState<string | null>(null);

  // Formulario de gestión
  const [actionType, setActionType] = useState<ActionType>(
    () => tiposCargables(tipificaciones)[0]?.tipo ?? "NOTE",
  );
  const [result, setResult] = useState<ActionResult | "">("");
  const [comment, setComment] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState("");

  // react-hooks/set-state-in-effect: acá el efecto es el lugar correcto. Trae la
  // ficha del deudor elegido desde el servidor, y el spinner tiene que prenderse
  // antes del await, no después. Mover esto a Suspense es un cambio de arquitectura
  // del panel, no parte de la subida de versión.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!clientId) {
      setDetail(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setActionType("CALL");
    setResult("");
    setComment("");
    setNextActionAt("");
    setPromiseAmount("");
    setPromiseDate("");

    loadClientDetail(clientId)
      .then((data) => {
        // El panel pudo cerrarse o cambiar de deudor mientras esto viajaba: pisar el
        // estado ahora mostraría la ficha equivocada.
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) toast.error("No se pudo cargar la ficha del deudor.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [clientId]);

  const tiposDisponibles = tiposCargables(tipificaciones);
  const availableResults = resultadosDe(tipificaciones, actionType);
  const isPromise = result === "PROMISE_PAY";

  function cambiarEstado(invoiceId: string, status: ManualInvoiceStatus) {
    setChangingInvoice(invoiceId);
    startSaving(async () => {
      const outcome = await setInvoiceStatus({ invoiceId, status });
      setChangingInvoice(null);

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }

      toast.success(`Comprobante marcado como ${INVOICE_STATUS_LABELS[status]}.`);
      // Se recarga la ficha: cambiar el estado movió el saldo del deudor, y dejar
      // el total viejo en pantalla es peor que tardar medio segundo.
      const clienteId = detail?.id;
      if (!clienteId) return;
      const fresh = await loadClientDetail(clienteId);
      if (fresh) setDetail(fresh);
      onDone(clienteId, false);
    });
  }

  function submitManagement() {
    if (!clientId) return;

    startSaving(async () => {
      const outcome = await saveManagementAction({
        clientId,
        actionType,
        result: result || null,
        comment: comment.trim() || null,
        nextActionAt: nextActionAt || null,
        promiseAmount: isPromise && promiseAmount ? Number(promiseAmount) : null,
        promiseDate: isPromise && promiseDate ? promiseDate : null,
      });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }

      toast.success("Gestión guardada.");
      // Si quedó agendado para más adelante, sale de la bandeja de hoy.
      const leftInbox = Boolean(nextActionAt && nextActionAt > today());
      onDone(clientId, leftInbox);
    });
  }

  return (
    <Sheet open={Boolean(clientId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {loading || !detail ? (
          <div className="flex flex-1 items-center justify-center">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-pand-azul" />
            ) : (
              <p className="text-sm text-pand-gris">No se encontró el deudor.</p>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              {/* ── A · Perfil ───────────────────────────────── */}
              <section className="border-b border-pand-border bg-white p-6">
                <div className="flex items-start justify-between gap-3">
                  <SheetTitle className="text-xl font-extrabold">
                    {detail.name}
                  </SheetTitle>
                  <Badge className={PRIORITY_BADGE[detail.priority]}>
                    {PRIORITY_LABEL[detail.priority]}
                  </Badge>
                </div>

                {detail.documentNumber && (
                  <p className="mono mt-1 text-xs text-pand-gris">
                    {detail.documentNumber}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  {[detail.phone, detail.phoneAlt].filter(Boolean).map((phone) => (
                    <div key={phone} className="flex gap-1">
                      <a
                        href={`tel:${phone}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-pand-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:border-pand-azul hover:text-pand-azul"
                      >
                        <Phone className="h-3.5 w-3.5" />
                        <span className="mono">{phone}</span>
                      </a>
                      <a
                        href={`https://wa.me/${toWhatsappNumber(phone!)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Abrir WhatsApp"
                        className="inline-flex items-center rounded-md border border-pand-border px-2 py-1.5 transition-colors hover:border-pand-azul hover:text-pand-azul"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  ))}
                  {!detail.phone && !detail.phoneAlt && (
                    <p className="text-xs text-pand-gris">Sin teléfonos cargados.</p>
                  )}
                </div>

                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                      Deuda total
                    </p>
                    <p className="mono mt-1 text-2xl font-medium">
                      {formatCurrency(detail.totalDebt, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                      Días de mora
                    </p>
                    <p
                      className={cn(
                        "mono mt-1 text-2xl font-medium",
                        detail.daysOverdue > 90 && "text-pand-coral",
                      )}
                    >
                      {formatNumber(detail.daysOverdue)}
                    </p>
                  </div>
                </div>

                {/* El score de riesgo lo produce el agente de IA (P07): mostrarlo en
                    un plan que no lo incluye seria prometer algo que no existe. */}
                {canSeeScore && detail.riskScore !== null && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                        Score de riesgo
                      </p>
                      <span className="mono text-xs">{detail.riskScore}/100</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-pand-border">
                      <div
                        className="h-full bg-pand-celeste"
                        style={{ width: `${detail.riskScore}%` }}
                      />
                    </div>
                  </div>
                )}

                <Button
                  variant="outline"
                  className="mt-5 w-full"
                  onClick={() => setPayOpen(true)}
                >
                  <Banknote className="mr-2 h-4 w-4" />
                  Registrar cobro
                </Button>
              </section>

              {/* ── B · Comprobantes ─────────────────────────── */}
              <section className="border-b border-pand-border p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                  Comprobantes
                </p>

                {detail.invoices.length === 0 ? (
                  <p className="mt-3 text-sm text-pand-gris">Sin comprobantes.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {detail.invoices.map((invoice) => {
                      const open =
                        invoice.status === "PENDING" || invoice.status === "PARTIAL";
                      const overdue = open && invoice.daysOverdue > 0;

                      return (
                        <div
                          key={invoice.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-pand-border p-3"
                        >
                          <div className="min-w-0">
                            <p className="mono text-sm font-medium">
                              {invoice.invoiceNumber}
                            </p>
                            {invoice.product && (
                              <p className="truncate text-xs font-semibold text-pand-contorno">
                                {invoice.product}
                              </p>
                            )}
                            <p className="mono text-xs text-pand-gris">
                              vence {invoice.dueDate}
                              {overdue && (
                                <span className="ml-2 text-pand-coral">
                                  +{invoice.daysOverdue} d
                                </span>
                              )}
                            </p>
                          </div>
                          <div className="text-right">
                            <p
                              className={cn(
                                "mono text-sm",
                                overdue && invoice.daysOverdue > 90 && "text-pand-coral",
                              )}
                            >
                              {formatCurrency(
                                invoice.amount - invoice.paidAmount,
                                currency,
                              )}
                            </p>
                            <p
                              className={cn(
                                "text-xs",
                                INVOICE_STATUS_TONE[invoice.status as InvoiceStatus],
                              )}
                            >
                              {INVOICE_STATUS_LABELS[invoice.status as InvoiceStatus] ??
                                invoice.status}
                            </p>

                            {canChangeInvoiceStatus && invoice.status !== "PAID" && (
                              <NativeSelect
                                aria-label={`Estado de ${invoice.invoiceNumber}`}
                                className="mt-1 h-7 w-[150px] text-xs"
                                value=""
                                disabled={changingInvoice === invoice.id}
                                onChange={(event) => {
                                  const next = event.target.value as ManualInvoiceStatus;
                                  if (!next) return;
                                  cambiarEstado(invoice.id, next);
                                }}
                              >
                                <option value="">Cambiar estado…</option>
                                {MANUAL_INVOICE_STATUSES.filter(
                                  (option) =>
                                    option.value !== invoice.status &&
                                    // "Volver a cartera" no tiene sentido si ya está.
                                    !(
                                      option.value === "PENDING" &&
                                      esCarteraActiva(invoice.status as InvoiceStatus)
                                    ),
                                ).map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                    title={option.hint}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </NativeSelect>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* ── C · Historial ────────────────────────────── */}
              <section className="p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                  Historial
                </p>

                {detail.history.length === 0 ? (
                  <p className="mt-3 text-sm text-pand-gris">
                    Todavía no hay gestiones registradas.
                  </p>
                ) : (
                  <ul className="mt-3 max-h-[280px] space-y-3 overflow-y-auto pr-1">
                    {detail.history.map((entry) => (
                      <li
                        key={entry.id}
                        className="border-l-2 border-pand-border pl-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {labelTipo(tipificaciones, entry.actionType)}
                          </span>
                          {entry.result && (
                            <Badge className="bg-pand-bg text-pand-gris hover:bg-pand-bg">
                              {labelResultado(tipificaciones, entry.result)}
                            </Badge>
                          )}
                          <span className="mono text-xs text-pand-gris">
                            {entry.createdAt.slice(0, 10)}
                          </span>
                        </div>
                        {entry.promiseAmount && (
                          <p className="mono mt-0.5 text-xs text-pand-azul">
                            Prometió {formatCurrency(entry.promiseAmount, currency)}
                            {entry.promiseDate && ` para el ${entry.promiseDate}`}
                          </p>
                        )}
                        {entry.comment && (
                          <p className="mt-0.5 text-sm text-pand-gris">
                            {entry.comment}
                          </p>
                        )}
                        {entry.operatorName && (
                          <p className="mt-0.5 text-xs text-pand-gris">
                            {entry.operatorName}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* ── D · Nueva gestión (siempre visible) ─────────── */}
            <section
              className={cn(
                "shrink-0 space-y-3 border-t border-pand-border bg-white p-6",
                focusManagement && "ring-2 ring-inset ring-pand-celeste",
              )}
            >
              <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                Nueva gestión
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="action-type" className="text-xs">
                    Tipo
                  </Label>
                  <NativeSelect
                    id="action-type"
                    value={actionType}
                    onChange={(event) => {
                      setActionType(event.target.value as ActionType);
                      // El resultado anterior puede no existir para el tipo nuevo.
                      setResult("");
                    }}
                  >
                    {tiposDisponibles.map((tipo) => (
                      <option key={tipo.tipo} value={tipo.tipo}>
                        {tipo.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="action-result" className="text-xs">
                    Resultado
                  </Label>
                  <NativeSelect
                    id="action-result"
                    value={result}
                    disabled={availableResults.length === 0}
                    onChange={(event) =>
                      setResult(event.target.value as ActionResult | "")
                    }
                  >
                    <option value="">
                      {availableResults.length === 0 ? "No aplica" : "— elegir —"}
                    </option>
                    {availableResults.map((option) => (
                      <option key={option} value={option}>
                        {labelResultado(tipificaciones, option)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>

              {isPromise && (
                <div className="grid grid-cols-2 gap-3 rounded-lg bg-pand-bg p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="promise-amount" className="text-xs">
                      Monto prometido
                    </Label>
                    <Input
                      id="promise-amount"
                      type="number"
                      min="1"
                      value={promiseAmount}
                      onChange={(event) => setPromiseAmount(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="promise-date" className="text-xs">
                      Fecha prometida
                    </Label>
                    <Input
                      id="promise-date"
                      type="date"
                      value={promiseDate}
                      onChange={(event) => setPromiseDate(event.target.value)}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="action-comment" className="text-xs">
                  Comentario
                </Label>
                <textarea
                  id="action-comment"
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  placeholder="Qué pasó en el contacto"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="next-action" className="text-xs">
                  Próximo seguimiento
                </Label>
                <Input
                  id="next-action"
                  type="date"
                  min={today()}
                  value={nextActionAt}
                  onChange={(event) => setNextActionAt(event.target.value)}
                />
                <p className="text-xs text-pand-gris">
                  Con una fecha futura, el deudor sale de la bandeja de hoy y vuelve
                  ese día.
                </p>
              </div>

              <Button
                className="w-full"
                onClick={submitManagement}
                disabled={saving}
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar gestión
              </Button>
            </section>

            <PaymentDialog
              open={payOpen}
              onOpenChange={setPayOpen}
              client={detail}
              currency={currency}
              onDone={(leftInbox) => {
                setPayOpen(false);
                onDone(detail.id, leftInbox);
              }}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Aviso reutilizable, por si el panel necesita marcar algo urgente. */
export function SheetWarning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-pand-bg p-3">
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-pand-coral" />
      <p className="text-xs text-pand-gris">{children}</p>
    </div>
  );
}
