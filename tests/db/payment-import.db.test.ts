import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionData } from "@/lib/auth/session";
import { resolverSettings } from "@/lib/config/settings";
import type { PaymentRow } from "@/lib/import/validate-payments";
import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearDeudor,
  crearOrganizacion,
  type Contexto,
} from "./fixtures";

/**
 * El importador de cobros.
 *
 * Esto mueve plata: baja deudas reales y deja comprobantes pagados. Lo que se
 * fija acá no es que ande, es que no cobre dos veces, que no le impute el cobro
 * al deudor equivocado, y que dos cobros del mismo deudor en un mismo lote se
 * apliquen uno después del otro y no los dos sobre la misma deuda.
 *
 * El lote se resuelve con unas pocas consultas y la imputación corre en memoria,
 * así que ese encadenamiento —que antes salía gratis porque cada fila releía la
 * base— ahora es una decisión del código. De ahí el test de los dos cobros.
 */

let ctx: Contexto;
let sesion: SessionData;

vi.mock("@/lib/auth/session", () => ({
  requireSession: () => Promise.resolve(sesion),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { importPaymentBatch } = await import("@/lib/import/payment-actions");

function sesionDe(ctx: Contexto, role: "ADMIN" | "OPERATOR" = "ADMIN"): SessionData {
  const settings = resolverSettings(undefined);
  return {
    user: {
      id: role === "ADMIN" ? ctx.adminId : ctx.operadorId,
      email: "quien@pand.demo",
      fullName: "Quien Cobra",
      role,
      avatarUrl: null,
    },
    organization: {
      id: ctx.organizationId,
      name: "TEST",
      slug: "test",
      sector: "FINANCIAL",
      plan: "PROFESSIONAL",
      trialEnds: null,
      isOnboarded: true,
      suspendedAt: null,
      currency: settings.currency,
      tipificaciones: settings.tipificaciones,
      cobranza: settings.cobranza,
    },
  };
}

let fila = 0;
function cobro(over: Partial<PaymentRow>): PaymentRow {
  fila += 1;
  return {
    rowNumber: fila,
    matchExternalId: null,
    matchDocument: null,
    invoiceNumber: null,
    amount: 100_000,
    paymentDate: "2026-11-10",
    reference: null,
    method: "BANK_TRANSFER",
    ...over,
  } as PaymentRow;
}

/** El external_id que le puso el fixture al deudor. */
async function externalDe(clientId: string): Promise<string> {
  const c = await prisma.client.findUnique({
    where: { id: clientId },
    select: { externalId: true },
  });
  return c!.externalId!;
}

async function comprobante(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    select: { amount: true, paidAmount: true, status: true, invoiceNumber: true },
  });
}

beforeEach(async () => {
  ctx = await crearOrganizacion("cobros");
  sesion = sesionDe(ctx);
  fila = 0;
});

afterEach(async () => {
  if (ctx) await borrarOrganizacion(ctx.organizationId);
});

describe("imputación", () => {
  it("baja primero el vencimiento más viejo y deja el saldo al día", async () => {
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Deudor", [
      { mora: 90, monto: 400_000 },
      { mora: 30, monto: 600_000 },
    ]);
    const externalId = await externalDe(clientId);

    const res = await importPaymentBatch({
      rows: [cobro({ matchExternalId: externalId, amount: 400_000 })],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(1);
    expect(res.allocated).toBe(400_000);
    expect(res.unallocated).toBe(0);
    expect(res.problems).toHaveLength(0);

    // El de 90 días de mora queda pagado; el de 30 intacto.
    expect((await comprobante(invoiceIds[0]!))?.status).toBe("PAID");
    expect((await comprobante(invoiceIds[1]!))?.status).toBe("PENDING");

    const deudor = await prisma.client.findUnique({
      where: { id: clientId },
      select: { totalDebt: true },
    });
    expect(Number(deudor?.totalDebt)).toBe(600_000);
  });

  it("dos cobros del mismo deudor en un lote se encadenan", async () => {
    // El caso que la imputación en memoria podría arruinar: si el segundo cobro
    // no viera lo que dejó el primero, los dos bajarían la misma deuda y el
    // deudor terminaría con plata cobrada que no se aplicó a nada.
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Deudor", [
      { mora: 90, monto: 500_000 },
      { mora: 60, monto: 500_000 },
    ]);
    const externalId = await externalDe(clientId);

    const res = await importPaymentBatch({
      rows: [
        cobro({ matchExternalId: externalId, amount: 500_000, reference: "R-1" }),
        cobro({ matchExternalId: externalId, amount: 500_000, reference: "R-2" }),
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(2);
    expect(res.allocated).toBe(1_000_000);
    expect(res.unallocated).toBe(0);

    // Cada cobro bajó un comprobante distinto.
    expect((await comprobante(invoiceIds[0]!))?.status).toBe("PAID");
    expect((await comprobante(invoiceIds[1]!))?.status).toBe("PAID");

    const deudor = await prisma.client.findUnique({
      where: { id: clientId },
      select: { totalDebt: true, status: true },
    });
    expect(Number(deudor?.totalDebt)).toBe(0);
    expect(deudor?.status).toBe("PAID");
  });

  it("dos cobros parciales sobre el mismo comprobante se suman", async () => {
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Deudor", [
      { mora: 40, monto: 1_000_000 },
    ]);
    const externalId = await externalDe(clientId);

    await importPaymentBatch({
      rows: [
        cobro({ matchExternalId: externalId, amount: 300_000, reference: "A" }),
        cobro({ matchExternalId: externalId, amount: 250_000, reference: "B" }),
      ],
    });

    const c = await comprobante(invoiceIds[0]!);
    expect(Number(c?.paidAmount)).toBe(550_000);
    expect(c?.status).toBe("PARTIAL");

    const deudor = await prisma.client.findUnique({
      where: { id: clientId },
      select: { totalDebt: true },
    });
    expect(Number(deudor?.totalDebt)).toBe(450_000);
  });

  it("el comprobante indicado en la planilla va antes que el FIFO", async () => {
    const { invoiceIds } = await crearDeudor(ctx, "Deudor", [
      { mora: 90, monto: 300_000 },
      { mora: 10, monto: 300_000 },
    ]);
    const nuevo = await comprobante(invoiceIds[1]!);
    const externalId = await externalDe(
      (await prisma.invoice.findUnique({
        where: { id: invoiceIds[0]! },
        select: { clientId: true },
      }))!.clientId,
    );

    await importPaymentBatch({
      rows: [
        cobro({
          matchExternalId: externalId,
          amount: 300_000,
          invoiceNumber: nuevo!.invoiceNumber,
        }),
      ],
    });

    // Se pagó el que pidió la planilla, no el más viejo.
    expect((await comprobante(invoiceIds[1]!))?.status).toBe("PAID");
    expect((await comprobante(invoiceIds[0]!))?.status).toBe("PENDING");
  });

  it("lo que sobra se informa y el cobro igual se registra", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 200_000 }]);
    const externalId = await externalDe(clientId);

    const res = await importPaymentBatch({
      rows: [cobro({ matchExternalId: externalId, amount: 500_000 })],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.allocated).toBe(200_000);
    expect(res.unallocated).toBe(300_000);
    expect(res.problems[0]?.status).toBe("unapplied");

    // La plata entró: el cobro queda registrado por los 500.000.
    const pagos = await prisma.payment.findMany({
      where: { clientId },
      select: { amount: true },
    });
    expect(pagos).toHaveLength(1);
    expect(Number(pagos[0]?.amount)).toBe(500_000);
  });

  it("un deudor sin deuda abierta igual recibe el cobro", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [
      { mora: 10, monto: 200_000, estado: "PAID" },
    ]);
    const externalId = await externalDe(clientId);

    const res = await importPaymentBatch({
      rows: [cobro({ matchExternalId: externalId, amount: 90_000 })],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.allocated).toBe(0);
    expect(res.unallocated).toBe(90_000);
    expect(res.problems[0]?.detail).toContain("sin imputar");
    expect(await prisma.payment.count({ where: { clientId } })).toBe(1);
  });

  it("no toca comprobantes castigados ni refinanciados", async () => {
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Deudor", [
      { mora: 120, monto: 300_000, estado: "WRITTEN_OFF" },
      { mora: 60, monto: 300_000, estado: "REFINANCED" },
      { mora: 30, monto: 300_000 },
    ]);
    const externalId = await externalDe(clientId);

    await importPaymentBatch({
      rows: [cobro({ matchExternalId: externalId, amount: 300_000 })],
    });

    expect((await comprobante(invoiceIds[0]!))?.status).toBe("WRITTEN_OFF");
    expect((await comprobante(invoiceIds[1]!))?.status).toBe("REFINANCED");
    expect((await comprobante(invoiceIds[2]!))?.status).toBe("PAID");
  });
});

describe("doble cobro", () => {
  it("una referencia ya cargada se saltea", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 900_000 }]);
    const externalId = await externalDe(clientId);

    await importPaymentBatch({
      rows: [cobro({ matchExternalId: externalId, amount: 100_000, reference: "DEP-77" })],
    });

    // La misma planilla, otra vez.
    const res = await importPaymentBatch({
      rows: [cobro({ matchExternalId: externalId, amount: 100_000, reference: "DEP-77" })],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(0);
    expect(res.duplicated).toBe(1);
    expect(res.problems[0]?.status).toBe("duplicated");

    // Un solo cobro y la deuda bajó una sola vez.
    expect(await prisma.payment.count({ where: { clientId } })).toBe(1);
    const deudor = await prisma.client.findUnique({
      where: { id: clientId },
      select: { totalDebt: true },
    });
    expect(Number(deudor?.totalDebt)).toBe(800_000);
  });

  it("una referencia repetida dentro del mismo lote se saltea sin voltear el lote", async () => {
    // Antes esto se estrellaba contra el unique de la base —el chequeo solo
    // miraba lo ya confirmado— y se perdía el lote entero, incluidos los cobros
    // buenos. Ahora se saltea la fila repetida y los demás entran.
    const a = await crearDeudor(ctx, "Uno", [{ mora: 10, monto: 500_000 }]);
    const b = await crearDeudor(ctx, "Dos", [{ mora: 10, monto: 500_000 }]);

    const res = await importPaymentBatch({
      rows: [
        cobro({ matchExternalId: await externalDe(a.clientId), amount: 100_000, reference: "X-1" }),
        cobro({ matchExternalId: await externalDe(a.clientId), amount: 100_000, reference: "X-1" }),
        cobro({ matchExternalId: await externalDe(b.clientId), amount: 200_000, reference: "X-2" }),
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(2);
    expect(res.duplicated).toBe(1);

    expect(await prisma.payment.count({ where: { clientId: a.clientId } })).toBe(1);
    expect(await prisma.payment.count({ where: { clientId: b.clientId } })).toBe(1);
  });

  it("los cobros sin referencia no se deduplican entre sí", async () => {
    // Postgres permite varios NULL en un índice único, y dos depósitos iguales
    // sin comprobante son dos depósitos: no hay con qué distinguirlos.
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 900_000 }]);
    const externalId = await externalDe(clientId);

    const res = await importPaymentBatch({
      rows: [
        cobro({ matchExternalId: externalId, amount: 100_000 }),
        cobro({ matchExternalId: externalId, amount: 100_000 }),
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(2);
    expect(res.duplicated).toBe(0);
    expect(await prisma.payment.count({ where: { clientId } })).toBe(2);
  });
});

describe("a quién se le imputa", () => {
  it("encuentra al deudor por documento", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 300_000 }]);
    await prisma.client.update({
      where: { id: clientId },
      data: { documentNumber: "4123456" },
    });

    const res = await importPaymentBatch({
      rows: [cobro({ matchDocument: "4123456", amount: 300_000 })],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(1);
    expect(await prisma.payment.count({ where: { clientId } })).toBe(1);
  });

  it("un documento repetido no se adivina: se informa", async () => {
    // El documento no es único en el schema. Elegir uno de los dos sería
    // imputarle el cobro a la persona equivocada.
    const a = await crearDeudor(ctx, "Uno", [{ mora: 10, monto: 300_000 }]);
    const b = await crearDeudor(ctx, "Dos", [{ mora: 10, monto: 300_000 }]);
    await prisma.client.updateMany({
      where: { id: { in: [a.clientId, b.clientId] } },
      data: { documentNumber: "9999999" },
    });

    const res = await importPaymentBatch({
      rows: [cobro({ matchDocument: "9999999", amount: 300_000 })],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(0);
    expect(res.problems[0]?.status).toBe("ambiguous");
    expect(await prisma.payment.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });

  it("un deudor que no existe se informa y no corta el lote", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 300_000 }]);

    const res = await importPaymentBatch({
      rows: [
        cobro({ matchExternalId: "NO-EXISTE", amount: 50_000 }),
        cobro({ matchExternalId: await externalDe(clientId), amount: 300_000 }),
      ],
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(1);
    expect(res.problems[0]?.status).toBe("not_found");
    expect(await prisma.payment.count({ where: { clientId } })).toBe(1);
  });

  it("no alcanza a un deudor de otra organización", async () => {
    // Prisma corre con BYPASSRLS: esto lo sostiene el filtro por organización y
    // nada más. Si se cae, un tenant le imputa cobros a otro.
    const otra = await crearOrganizacion("cobros-ajena");
    try {
      const ajeno = await crearDeudor(otra, "Ajeno", [{ mora: 10, monto: 300_000 }]);
      const externalId = await externalDe(ajeno.clientId);

      const res = await importPaymentBatch({
        rows: [cobro({ matchExternalId: externalId, amount: 300_000 })],
      });

      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.applied).toBe(0);
      expect(res.problems[0]?.status).toBe("not_found");
      expect(await prisma.payment.count({ where: { clientId: ajeno.clientId } })).toBe(0);
    } finally {
      await borrarOrganizacion(otra.organizationId);
    }
  });

  it("un operador no puede importar cobros", async () => {
    sesion = sesionDe(ctx, "OPERATOR");
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 300_000 }]);

    const res = await importPaymentBatch({
      rows: [cobro({ matchExternalId: await externalDe(clientId), amount: 100_000 })],
    });

    expect(res.ok).toBe(false);
    expect(await prisma.payment.count({ where: { clientId } })).toBe(0);
  });
});

describe("lote grande", () => {
  it("imputa cien cobros a cien deudores sin perder ninguno", async () => {
    const deudores: { clientId: string; externalId: string }[] = [];
    for (let i = 0; i < 100; i += 1) {
      const d = await crearDeudor(ctx, `D${i}`, [{ mora: 30, monto: 500_000 }]);
      deudores.push({ clientId: d.clientId, externalId: await externalDe(d.clientId) });
    }

    const res = await importPaymentBatch({
      rows: deudores.map((d, i) =>
        cobro({ matchExternalId: d.externalId, amount: 500_000, reference: `L-${i}` }),
      ),
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.applied).toBe(100);
    expect(res.allocated).toBe(50_000_000);
    expect(res.unallocated).toBe(0);
    expect(res.problems).toHaveLength(0);

    expect(
      await prisma.payment.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(100);
    expect(
      await prisma.invoice.count({
        where: { organizationId: ctx.organizationId, status: "PAID" },
      }),
    ).toBe(100);
    // Y todos los saldos quedaron en cero con un solo recálculo.
    expect(
      await prisma.client.count({
        where: { organizationId: ctx.organizationId, totalDebt: { gt: 0 } },
      }),
    ).toBe(0);
  }, 300_000);
});
