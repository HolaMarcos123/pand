"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { idSchema } from "@/lib/validation/id";


import type { InvoiceStatus } from "@/generated/prisma/enums";
import type { ManualInvoiceStatus } from "@/lib/collections/invoice-status";
import { requireSession } from "@/lib/auth/session";
import { PAYMENT_METHOD_VALUES } from "@/lib/import/payment-config";
import { allocateToInvoices, refreshClientBalance } from "@/lib/payments/apply";
import { prisma } from "@/lib/prisma";
import { getClientDetail } from "@/lib/queries/tasks";
import {
  resultadoDe,
  tipoDe,
  type ResultadoConfig,
} from "@/lib/config/settings";

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
  clientId: idSchema,
  /**
   * Códigos de tipificación, no los enums.
   *
   * Puede llegar "CALL" —una de fábrica— o "carta_documento" —una que creó la
   * organización—. El enum que se guarda en la base se resuelve acá contra la
   * configuración, así que un código inventado no entra: no hay un `z.enum` que
   * lo valide porque la lista depende de la organización.
   */
  actionType: z.string().trim().min(1).max(40),
  result: z.string().trim().min(1).max(40).nullish(),
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

  // El tipo y el resultado se validan contra la configuración de la organización
  // y no contra el catálogo completo del producto. Es lo que impide que una
  // pestaña abierta desde antes de un cambio de configuración siga cargando una
  // tipificación que el administrador apagó o borró —y, de paso, que un POST
  // armado a mano deje "Ocupado" en un email y ensucie el reporte de efectividad
  // por canal.
  const tipificaciones = session.organization.tipificaciones;

  const tipo = tipoDe(tipificaciones, data.actionType);
  if (!tipo || !tipo.manual || !tipo.activo) {
    return { ok: false, error: "Ese tipo de gestión no está disponible." };
  }

  let resultado: ResultadoConfig | null = null;
  if (data.result) {
    if (!tipo.resultados.includes(data.result)) {
      return { ok: false, error: "Ese resultado no corresponde al tipo de gestión." };
    }
    resultado = resultadoDe(tipificaciones, data.result) ?? null;
    if (!resultado) {
      return { ok: false, error: "Ese resultado no existe en tu configuración." };
    }
  }

  // Por el significado heredado y no por el código: si la organización llama
  // "Acordó refinanciar" a un resultado que cuenta como promesa, también necesita
  // monto y fecha. Si no, el reporte de cumplimiento tendría promesas sin nada que
  // cumplir.
  const esPromesa = resultado?.base === "PROMISE_PAY";

  if (esPromesa && (!data.promiseAmount || !data.promiseDate)) {
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
        // El enum lleva el significado —de ahí salen todos los reportes— y la
        // columna *_code, el nombre que eligió la organización. Las de fábrica no
        // guardan código: su enum ya es su código y repetirlo sería redundante.
        actionType: tipo.base,
        typeCode: tipo.propia ? tipo.tipo : null,
        result: resultado?.base ?? null,
        resultCode: resultado?.propia ? resultado.codigo : null,
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
    if (esPromesa && client.status !== "PROMISE") {
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
  clientId: idSchema,
  invoiceIds: z.array(idSchema).max(100).default([]),
  amount: z.number().positive().max(1e15),
  paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  method: z.enum(PAYMENT_METHOD_VALUES),
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

const invoiceStatusSchema = z.object({
  invoiceId: idSchema,
  // Solo los que se ponen a mano. PAID y PARTIAL los calcula el sistema a partir
  // de los cobros: dejarlos acá permitiría marcar como pagado sin registrar plata.
  status: z.enum(
    ["PENDING", "REFINANCED", "WRITTEN_OFF", "CANCELLED"] satisfies ManualInvoiceStatus[],
  ),
});

/**
 * Refinancia, castiga, anula o devuelve un comprobante a la cartera activa.
 *
 * No lo puede hacer un operador. Castigar una deuda la saca de la cartera activa y
 * del recupero del que depende su propio número; es una decisión de quien responde
 * por la cartera.
 *
 * Al volver a PENDING el estado real se recalcula contra lo ya cobrado: si tenía
 * pagos parciales vuelve como PARTIAL y si estaba cubierto vuelve como PAID. Poner
 * PENDING a secas resucitaría deuda que ya se cobró.
 */
export async function setInvoiceStatus(
  input: z.infer<typeof invoiceStatusSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Solo un supervisor puede cambiar el estado de una deuda." };
  }

  const parsed = invoiceStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos inválidos." };

  const organizationId = session.organization.id;

  const invoice = await prisma.invoice.findFirst({
    // El filtro por organizationId no es opcional: Prisma corre con BYPASSRLS.
    where: { id: parsed.data.invoiceId, organizationId },
    select: { id: true, clientId: true, amount: true, paidAmount: true },
  });
  if (!invoice) return { ok: false, error: "No se encontró el comprobante." };

  let status: InvoiceStatus = parsed.data.status;
  if (status === "PENDING") {
    const pagado = invoice.paidAmount;
    if (pagado.greaterThanOrEqualTo(invoice.amount)) status = "PAID";
    else if (pagado.greaterThan(0)) status = "PARTIAL";
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: invoice.id }, data: { status } });
    // El saldo del deudor sale de sus comprobantes abiertos: si este dejó de serlo,
    // el total_debt de clients quedó mintiendo hasta que se recalcule.
    await refreshClientBalance(tx, organizationId, invoice.clientId);
  });

  revalidatePath("/clients");
  revalidatePath("/tasks");
  revalidatePath("/overview");

  return { ok: true };
}
