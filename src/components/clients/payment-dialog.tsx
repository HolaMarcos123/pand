"use client";

import { Loader2 } from "lucide-react";

import type { PaymentMethod } from "@/generated/prisma/enums";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { formatCurrency } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/import/payment-config";
import type { ClientDetail } from "@/lib/queries/tasks";
import { registerPayment } from "@/lib/tasks/actions";

export function PaymentDialog({
  open,
  onOpenChange,
  client,
  currency,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: ClientDetail;
  currency: string;
  onDone: (leftInbox: boolean) => void;
}) {
  const openInvoices = useMemo(
    () =>
      client.invoices.filter(
        (invoice) => invoice.status === "PENDING" || invoice.status === "PARTIAL",
      ),
    [client.invoices],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [amountDraft, setAmountDraft] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<string>("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [saving, startSaving] = useTransition();

  const selectedTotal = useMemo(
    () =>
      openInvoices
        .filter((invoice) => selected.includes(invoice.id))
        .reduce((sum, invoice) => sum + (invoice.amount - invoice.paidAmount), 0),
    [openInvoices, selected],
  );

  // El monto sigue a lo tildado hasta que el usuario lo edita a mano: a partir de
  // ahí manda él, porque un cobro parcial sobre una factura elegida es normal.
  //
  // Es un valor **derivado**, no estado: se calcula en el render. Antes vivía en un
  // efecto que escribía estado, y eso dispara un render en cascada por cada tilde.
  const amount = amountTouched
    ? amountDraft
    : selectedTotal
      ? String(selectedTotal)
      : "";

  // Reset al cerrar. También en el render, con el patrón que documenta React para
  // "cambió una prop y hay que reiniciar estado": comparar contra el valor anterior.
  // En un efecto, React pinta el diálogo con los datos del cobro anterior y recién
  // después los limpia.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setSelected([]);
      setAmountDraft("");
      setAmountTouched(false);
      setReference("");
      setMethod("BANK_TRANSFER");
    }
  }

  function toggle(invoiceId: string) {
    setSelected((current) =>
      current.includes(invoiceId)
        ? current.filter((id) => id !== invoiceId)
        : [...current, invoiceId],
    );
  }

  function submit() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Poné un monto mayor a cero.");
      return;
    }

    startSaving(async () => {
      const outcome = await registerPayment({
        clientId: client.id,
        invoiceIds: selected,
        amount: value,
        paymentDate: date,
        method: method as PaymentMethod,
        reference: reference.trim() || null,
      });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }

      if (outcome.remaining > 0) {
        toast.warning(
          `Cobro registrado. Sobraron ${formatCurrency(outcome.remaining, currency)} sin comprobante contra el cual imputar.`,
        );
      } else {
        toast.success(
          `Cobro de ${formatCurrency(outcome.allocated, currency)} aplicado.`,
        );
      }

      onDone(outcome.clientPaid);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar cobro</DialogTitle>
          <DialogDescription>
            Tildá los comprobantes a cancelar. Si dejás todo sin tildar, el cobro baja
            los vencimientos más viejos primero.
          </DialogDescription>
        </DialogHeader>

        {openInvoices.length === 0 ? (
          <p className="text-sm text-pand-gris">
            Este deudor no tiene comprobantes abiertos. El cobro se va a registrar sin
            imputar.
          </p>
        ) : (
          <div className="max-h-52 space-y-1.5 overflow-y-auto">
            {openInvoices.map((invoice) => {
              const pending = invoice.amount - invoice.paidAmount;
              return (
                <label
                  key={invoice.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-pand-border p-2.5 hover:bg-pand-bg"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(invoice.id)}
                    onChange={() => toggle(invoice.id)}
                    className="h-4 w-4 rounded border-pand-border"
                  />
                  <span className="mono flex-1 text-sm">{invoice.invoiceNumber}</span>
                  <span className="mono text-xs text-pand-gris">
                    {invoice.dueDate}
                  </span>
                  <span className="mono text-sm">
                    {formatCurrency(pending, currency)}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="pay-amount">Monto cobrado</Label>
            <Input
              id="pay-amount"
              type="number"
              min="1"
              value={amount}
              onChange={(event) => {
                setAmountTouched(true);
                setAmountDraft(event.target.value);
              }}
            />
            {selected.length > 0 && (
              <p className="mono text-xs text-pand-gris">
                Seleccionado: {formatCurrency(selectedTotal, currency)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-date">Fecha</Label>
              <Input
                id="pay-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Medio</Label>
              <NativeSelect
                id="pay-method"
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {PAYMENT_METHODS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-reference">Referencia</Label>
            <Input
              id="pay-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Nro. de operación"
            />
            {/* Misma red que en el importador: la referencia es lo que evita cargar
                dos veces el mismo cobro. */}
            <p className="text-xs text-pand-gris">
              Con referencia, el sistema evita que este cobro se cargue dos veces.
            </p>
          </div>
        </div>

        <Button onClick={submit} disabled={saving} className="w-full">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Confirmar cobro
        </Button>
      </DialogContent>
    </Dialog>
  );
}
