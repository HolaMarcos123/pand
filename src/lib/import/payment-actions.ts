"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/session";
import {
  paymentBatchSchema,
  type PaymentRow,
} from "@/lib/import/validate-payments";
import {
  planificarImputacion,
  refreshClientBalances,
  type InvoiceChange,
  type OpenInvoice,
} from "@/lib/payments/apply";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export type PaymentOutcome = {
  row: number;
  status: "duplicated" | "not_found" | "ambiguous" | "unapplied";
  detail: string;
};

export type PaymentImportResult =
  | {
      ok: true;
      applied: number;
      duplicated: number;
      /** Plata efectivamente imputada a comprobantes. */
      allocated: number;
      /** Cobros registrados que no encontraron deuda abierta contra la cual imputar. */
      unallocated: number;
      problems: PaymentOutcome[];
    }
  | { ok: false; error: string };

/**
 * Aplica un lote de cobros.
 *
 * Tres decisiones que el brief no define y que cambian el resultado en plata:
 *
 * 1. **Imputación FIFO.** Sin comprobante indicado, el cobro se aplica a los
 *    vencimientos más viejos primero. Es lo que hace cualquier área de cobranzas:
 *    baja primero la mora que más pesa en los tramos.
 *
 * 2. **Deduplicación por referencia.** Si la fila trae referencia y ya existe un
 *    cobro con esa referencia en el tenant, se saltea. Es la única defensa contra
 *    subir dos veces la misma planilla, que duplicaría la plata cobrada y dejaría
 *    facturas pagadas que nadie pagó. Hay además un unique en la base por si el
 *    chequeo se escapa.
 *
 * 3. **Un cobro sin deuda abierta igual se registra.** La plata entró: perderla
 *    porque no había contra qué imputarla sería peor que registrarla y avisar.
 */
export async function importPaymentBatch(input: {
  rows: PaymentRow[];
}): Promise<PaymentImportResult> {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return { ok: false, error: "Los operadores no pueden importar cobros." };
  }

  const parsed = paymentBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "El lote llegó con filas inválidas." };
  }

  const organizationId = session.organization.id;
  const currency = session.organization.currency;
  const registeredById = session.user.id;
  const { rows } = parsed.data;
  const ahora = new Date();

  let applied = 0;
  let duplicated = 0;
  let allocated = new Prisma.Decimal(0);
  let unallocated = new Prisma.Decimal(0);
  const problems: PaymentOutcome[] = [];

  await prisma.$transaction(
    async (tx) => {
      // ───────────────────────────────────────────────────────────────────────
      // Por qué el lote se resuelve de una vez y no fila por fila.
      //
      // Antes cada cobro hacía sus propias consultas: buscar al deudor por ID,
      // buscarlo por documento, ver si la referencia ya estaba, traer sus
      // comprobantes abiertos, escribir cada uno, insertar el cobro y recalcular
      // el saldo. Seis a ocho viajes a la base por fila, uno después del otro, y
      // la base casi no trabajaba: se esperaba la latencia de cada ida y vuelta.
      //
      // Ahora son unas pocas consultas de tamaño fijo, la aritmética corre en
      // memoria y todo se escribe junto al final. La aritmética es la misma:
      // `planificarImputacion`, la que usa el modal de la bandeja. Lo único que
      // cambió es cuándo se va a la base.
      // ───────────────────────────────────────────────────────────────────────

      // ── 1. Resolver deudores y duplicados para todo el lote ──────────────
      const externalIds = [
        ...new Set(rows.map((r) => r.matchExternalId).filter((v): v is string => !!v)),
      ];
      const documentos = [
        ...new Set(rows.map((r) => r.matchDocument).filter((v): v is string => !!v)),
      ];
      const referencias = [
        ...new Set(rows.map((r) => r.reference).filter((v): v is string => !!v)),
      ];

      const porExternal = new Map<string, string>();
      if (externalIds.length > 0) {
        const encontrados = await tx.client.findMany({
          where: { organizationId, externalId: { in: externalIds } },
          select: { id: true, externalId: true },
        });
        for (const c of encontrados) {
          if (c.externalId) porExternal.set(c.externalId, c.id);
        }
      }

      // El documento no es único en el schema: dos deudores pueden compartirlo.
      // Se guardan todos los que coinciden para poder distinguir "no está" de
      // "hay varios" —adivinar cuál es arriesga imputarle el cobro al equivocado—.
      const porDocumento = new Map<string, string[]>();
      if (documentos.length > 0) {
        const encontrados = await tx.client.findMany({
          where: { organizationId, documentNumber: { in: documentos } },
          select: { id: true, documentNumber: true },
        });
        for (const c of encontrados) {
          if (!c.documentNumber) continue;
          const lista = porDocumento.get(c.documentNumber) ?? [];
          lista.push(c.id);
          porDocumento.set(c.documentNumber, lista);
        }
      }

      const yaCargadas = new Set<string>();
      if (referencias.length > 0) {
        const existentes = await tx.payment.findMany({
          where: { organizationId, reference: { in: referencias } },
          select: { reference: true },
        });
        for (const p of existentes) {
          if (p.reference) yaCargadas.add(p.reference);
        }
      }

      // ── 2. Clasificar cada fila ──────────────────────────────────────────
      const pendientes: { row: PaymentRow; clientId: string }[] = [];
      const referenciasDelLote = new Set<string>();

      for (const row of rows) {
        let clientId: string | null = null;

        if (row.matchExternalId) {
          clientId = porExternal.get(row.matchExternalId) ?? null;
        }

        if (!clientId && row.matchDocument) {
          const candidatos = porDocumento.get(row.matchDocument) ?? [];

          if (candidatos.length > 1) {
            problems.push({
              row: row.rowNumber,
              status: "ambiguous",
              detail: `hay más de un deudor con el documento ${row.matchDocument}`,
            });
            continue;
          }

          clientId = candidatos[0] ?? null;
        }

        if (!clientId) {
          problems.push({
            row: row.rowNumber,
            status: "not_found",
            detail: `no existe el deudor ${row.matchExternalId ?? row.matchDocument}`,
          });
          continue;
        }

        if (row.reference) {
          // Ya cargada en otra oportunidad, o repetida dentro de este mismo
          // lote. Lo segundo antes se estrellaba contra el unique de la base
          // —el chequeo solo miraba lo ya confirmado— y volteaba el lote
          // entero: es más útil saltear la fila y decir cuál era.
          if (yaCargadas.has(row.reference) || referenciasDelLote.has(row.reference)) {
            duplicated += 1;
            problems.push({
              row: row.rowNumber,
              status: "duplicated",
              detail: `la referencia ${row.reference} ya estaba cargada`,
            });
            continue;
          }
          referenciasDelLote.add(row.reference);
        }

        pendientes.push({ row, clientId });
      }

      // ── 3. Traer los comprobantes abiertos de todos los deudores ─────────
      const clientIds = [...new Set(pendientes.map((p) => p.clientId))];
      const abiertosPorCliente = new Map<string, OpenInvoice[]>();

      if (clientIds.length > 0) {
        const abiertos = await tx.invoice.findMany({
          where: {
            organizationId,
            clientId: { in: clientIds },
            status: { in: ["PENDING", "PARTIAL"] },
          },
          // El orden es el FIFO del que depende la imputación, y agrupar por
          // deudor lo conserva dentro de cada grupo.
          orderBy: { dueDate: "asc" },
          select: {
            id: true,
            clientId: true,
            amount: true,
            paidAmount: true,
            invoiceNumber: true,
          },
        });

        for (const i of abiertos) {
          const lista = abiertosPorCliente.get(i.clientId) ?? [];
          lista.push(i);
          abiertosPorCliente.set(i.clientId, lista);
        }
      }

      // ── 4. Imputar en memoria ────────────────────────────────────────────
      // Por comprobante gana el último cambio: `paidAmount` es acumulado, así
      // que el último ya incluye lo que aplicaron los cobros anteriores.
      const cambios = new Map<string, InvoiceChange>();
      const cobros: { clientId: string; invoiceId: string | null; row: PaymentRow }[] = [];

      for (const { row, clientId } of pendientes) {
        const abiertos = abiertosPorCliente.get(clientId) ?? [];

        const plan = planificarImputacion(abiertos, {
          amount: row.amount,
          preferredInvoiceNumbers: row.invoiceNumber ? [row.invoiceNumber] : undefined,
        });

        // Lo imputado se refleja en la copia en memoria para que el próximo
        // cobro del mismo deudor vea la deuda ya bajada, igual que cuando cada
        // fila releía la base. Dos cobros del mismo deudor en un lote es lo
        // normal, no un borde.
        for (const cambio of plan.changes) {
          const comprobante = abiertos.find((i) => i.id === cambio.invoiceId);
          if (comprobante) comprobante.paidAmount = cambio.paidAmount;
          cambios.set(cambio.invoiceId, cambio);
        }

        allocated = allocated.plus(plan.allocated);

        if (plan.remaining.greaterThan(0)) {
          unallocated = unallocated.plus(plan.remaining);
          problems.push({
            row: row.rowNumber,
            status: "unapplied",
            detail: plan.allocated.equals(0)
              ? "el deudor no tiene comprobantes abiertos; el cobro quedó registrado sin imputar"
              : `sobraron ${plan.remaining.toString()} sin comprobante contra el cual imputar`,
          });
        }

        cobros.push({ clientId, invoiceId: plan.firstInvoiceId, row });
        applied += 1;
      }

      // ── 5. Escribir ──────────────────────────────────────────────────────
      if (cambios.size > 0) {
        const lista = [...cambios.values()];
        await tx.$executeRaw`
          UPDATE invoices i
             SET paid_amount = t.paid_amount,
                 status = t.status::"InvoiceStatus",
                 updated_at = ${ahora}::timestamptz
            FROM unnest(
                   ${lista.map((c) => c.invoiceId)}::uuid[],
                   ${lista.map((c) => c.paidAmount.toFixed(2))}::numeric[],
                   ${lista.map((c) => c.status)}::text[]
                 ) AS t(id, paid_amount, status)
           WHERE i.id = t.id
             AND i.organization_id = ${organizationId}::uuid
        `;
      }

      if (cobros.length > 0) {
        await tx.$executeRaw`
          INSERT INTO payments (
            id, organization_id, client_id, invoice_id, amount, currency,
            payment_date, payment_method, reference, registered_by
          )
          SELECT gen_random_uuid(), ${organizationId}::uuid, t.client_id,
                 t.invoice_id, t.amount, ${currency}, t.payment_date,
                 t.method::"PaymentMethod", t.reference, ${registeredById}::uuid
            FROM unnest(
                   ${cobros.map((c) => c.clientId)}::uuid[],
                   ${cobros.map((c) => c.invoiceId)}::uuid[],
                   ${cobros.map((c) => c.row.amount.toFixed(2))}::numeric[],
                   ${cobros.map((c) => c.row.paymentDate)}::date[],
                   ${cobros.map((c) => c.row.method)}::text[],
                   ${cobros.map((c) => c.row.reference)}::text[]
                 ) AS t(client_id, invoice_id, amount, payment_date, method, reference)
        `;
      }

      // Un solo recálculo para todos los deudores tocados, en vez de uno por fila.
      await refreshClientBalances(tx, organizationId, clientIds);
    },
    // El default de Prisma son 5 segundos, y al pasarlos rechaza el commit: el
    // lote entero se revierte. Con las escrituras agrupadas sobra, pero el
    // margen no se deja al azar.
    { timeout: 60_000, maxWait: 15_000 },
  );

  revalidatePath("/overview");
  revalidatePath("/portfolio");

  return {
    ok: true,
    applied,
    duplicated,
    allocated: Number(allocated),
    unallocated: Number(unallocated),
    problems,
  };
}
