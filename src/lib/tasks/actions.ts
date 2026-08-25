"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { allocateToInvoices, refreshClientBalance } from "@/lib/payments/apply";
import { prisma } from "@/lib/prisma";
import { getClientDetail } from "@/lib/queries/tasks";
import { RESULTS_BY_TYPE } from "@/lib/tasks/action-config";

export type TaskActionResult = { ok: true } | { ok: false; error: string };

/**
 * Ficha del deudor para el panel lateral.
 *
 * Se carga al abrir y no junto con la bandeja: traer facturas e historial de 500
 * deudores para mostrar uno sería pagar por adelantado algo que casi nunca se usa.
 */
export async function loadClientDetail(clientId: string) {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    const own = await prisma.client.findFirst({
      where: {
        id: clientId,
        organizationId: session.organization.id,
        assignedToId: session.user.id,
      },
      select: { id: true },
    });
    if (!own) return null;
  }

  return getClientDetail(session.organization.id, clientId);
}

const managementSchema = z.object({
  clientId: z.string().uuid(),
  actionType: z.enum([
    "CALL",
    "EMAIL",
    "WHATSAPP",
    "VISIT",
    "SMS",
    "NOTE",
    "PROMISE",
    "AI_CALL",
  ]),
  result: z
    .enum([
      "NO_ANSWER",
      "BUSY",
      "PROMISE_PAY",
      "REFUSED",
      "PAID",
      "CALLBACK",
      "WRONG_NUMBER",
    ])
    .nullish(),
  comment: z.string().trim().max(2000).nullish(),
  nextActionAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  promiseAmount: z.number().positive().max(1e15).nullish(),
  promiseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

/**
 * Registra una gestión.
 *
 * `clients.next_action_at` no se escribe acá: lo propaga el trigger
 * `management_actions_sync_next_action` del P01. Escribirlo también desde el código
 * sería una segunda fuente de verdad para el mismo dato.
 */
export async function saveManagementAction(
  input: z.infer<typeof managementSchema>,
): Promise<TaskActionResult> {
  const session = await requireSession();

  const parsed = managementSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos de la gestión inválidos." };

  const data = parsed.data;

  // El resultado tiene que ser uno de los válidos para ese tipo. Sin esto, un POST
  // armado a mano podría dejar "Ocupado" en un email y ensuciar los reportes de
  // efectividad por canal.
  const allowed = RESULTS_BY_TYPE[data.actionType];
  if (data.result && !allowed.includes(data.result)) {
    return { ok: false, error: "Ese resultado no corresponde al tipo de gestión." };
  }

  if (data.result === "PROMISE_PAY" && (!data.promiseAmount || !data.promiseDate)) {
    return {
      ok: false,
      error: "Una promesa necesita monto y fecha: sin eso no se puede hacer seguimiento.",
    };
  }

  const client = await prisma.client.findFirst({
    where: {
      id: data.clientId,
      organizationId: session.organization.id,
      // Un operador solo gestiona su propia cartera.
      ...(session.user.role === "OPERATOR" ? { assignedToId: session.user.id } : {}),
    },
    select: { id: true, status: true },
  });

  if (!client) return { ok: false, error: "El deudor no existe o no es tuyo." };

  await prisma.$transaction(async (tx) => {
    await tx.managementAction.create({
      data: {
        organizationId: session.organization.id,
        clientId: client.id,
        operatorId: session.user.id,
        actionType: data.actionType,
        result: data.result ?? null,
        comment: data.comment ?? null,
        nextActionAt: data.nextActionAt
          ? new Date(`${data.nextActionAt}T09:00:00Z`)
          : null,
        promiseAmount: data.promiseAmount ?? null,
        promiseDate: data.promiseDate ? new Date(`${data.promiseDate}T00:00:00Z`) : null,
      },
    });

    // Una promesa cambia el estado del deudor; el resto de los resultados no, porque
    // "no atiende" no dice nada nuevo sobre su situación.
    if (data.result === "PROMISE_PAY" && client.status !== "PROMISE") {
      await tx.client.update({
        where: { id: client.id },
        data: { status: "PROMISE" },
      });
    }
  });

  revalidatePath("/tasks");
  revalidatePath("/overview");
  return { ok: true };
}

const paymentSchema = z.object({
  clientId: z.string().uuid(),
  invoiceIds: z.array(z.string().uuid()).max(100).default([]),
  amount: z.number().positive().max(1e15),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHECK", "DEPOSIT", "OTHER"]),
  reference: z.string().trim().max(120).nullish(),
});

export type RegisterPaymentResult =
  | { ok: true; allocated: number; remaining: number; clientPaid: boolean }
  | { ok: false; error: string };

/**
 * Cobro cargado a mano desde la bandeja.
 *
 * Usa exactamente la misma imputación que el importador de planillas: si la plata
 * bajara distinto según por dónde entró, los números del dashboard dejarían de
 * cerrar contra la cartera.
 */
export async function registerPayment(
  input: z.infer<typeof paymentSchema>,
): Promise<RegisterPaymentResult> {
  const session = await requireSession();

  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos del cobro inválidos." };

  const data = parsed.data;
  const organizationId = session.organization.id;

  const client = await prisma.client.findFirst({
    where: {
      id: data.clientId,
      organizationId,
      ...(session.user.role === "OPERATOR" ? { assignedToId: session.user.id } : {}),
    },
    select: { id: true },
  });

  if (!client) return { ok: false, error: "El deudor no existe o no es tuyo." };

  if (data.reference) {
    const existing = await prisma.payment.findFirst({
      where: { organizationId, reference: data.reference },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error: `Ya hay un cobro cargado con la referencia ${data.reference}.`,
      };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const allocation = await allocateToInvoices(tx, {
      organizationId,
      clientId: client.id,
      amount: data.amount,
      preferredInvoiceIds: data.invoiceIds,
    });

    await tx.payment.create({
      data: {
        organizationId,
        clientId: client.id,
        invoiceId: allocation.firstInvoiceId,
        amount: data.amount,
        currency: session.organization.currency,
        paymentDate: new Date(`${data.paymentDate}T00:00:00Z`),
        paymentMethod: data.method,
        reference: data.reference ?? null,
        registeredById: session.user.id,
      },
    });

    await refreshClientBalance(tx, organizationId, client.id);

    const after = await tx.client.findUniqueOrThrow({
      where: { id: client.id },
      select: { status: true },
    });

    return {
      allocated: Number(allocation.allocated),
      remaining: Number(allocation.remaining),
      clientPaid: after.status === "PAID",
    };
  });

  revalidatePath("/tasks");
  revalidatePath("/overview");
  revalidatePath("/portfolio");

  return { ok: true, ...result };
}
