import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { allocateToInvoices, refreshClientBalance } from "@/lib/payments/apply";
import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearDeudor,
  crearOrganizacion,
  type Contexto,
} from "./fixtures";

/**
 * Imputación de cobros y saldo del deudor.
 *
 * Es la aritmética de la que depende todo lo demás: si un cobro baja la deuda
 * equivocada, el tramo, el recupero y el cumplimiento de promesas quedan mal los
 * tres, y ninguno avisa.
 */

let ctx: Contexto;

beforeEach(async () => {
  // Organización nueva por test: cada uno arranca con la cartera limpia.
  ctx = await crearOrganizacion("cobros");
});

// afterEach y no afterAll: acá se crea una organización por test, así que
// borrar solo al final dejaría todas las anteriores tiradas en la base.
afterEach(async () => {
  if (ctx) await borrarOrganizacion(ctx.organizationId);
});

async function estadoDe(invoiceIds: string[]) {
  const filas = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds } },
    select: { id: true, paidAmount: true, status: true },
  });
  return invoiceIds.map((id) => {
    const fila = filas.find((f) => f.id === id)!;
    return { pagado: Number(fila.paidAmount), estado: fila.status };
  });
}

describe("allocateToInvoices", () => {
  it("baja primero el vencimiento más viejo (FIFO)", async () => {
    const { clientId, invoiceIds } = await crearDeudor(ctx, "FIFO", [
      { mora: 90, monto: 1_000_000 },
      { mora: 30, monto: 1_000_000 },
    ]);

    const r = await prisma.$transaction((tx) =>
      allocateToInvoices(tx, {
        organizationId: ctx.organizationId,
        clientId,
        amount: 1_000_000,
      }),
    );

    const [viejo, nuevo] = await estadoDe(invoiceIds);
    expect(viejo.estado).toBe("PAID");
    expect(nuevo.estado).toBe("PENDING");
    expect(Number(r.allocated)).toBe(1_000_000);
    expect(Number(r.remaining)).toBe(0);
  });

  it("los comprobantes elegidos a mano van antes que el FIFO", async () => {
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Elegido", [
      { mora: 90, monto: 1_000_000 },
      { mora: 30, monto: 1_000_000 },
    ]);

    await prisma.$transaction((tx) =>
      allocateToInvoices(tx, {
        organizationId: ctx.organizationId,
        clientId,
        amount: 1_000_000,
        preferredInvoiceIds: [invoiceIds[1]],
      }),
    );

    const [viejo, elegido] = await estadoDe(invoiceIds);
    expect(elegido.estado).toBe("PAID");
    expect(viejo.estado).toBe("PENDING");
  });

  it("un cobro que no alcanza deja el comprobante en parcial", async () => {
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Parcial", [
      { mora: 20, monto: 1_000_000 },
    ]);

    await prisma.$transaction((tx) =>
      allocateToInvoices(tx, {
        organizationId: ctx.organizationId,
        clientId,
        amount: 400_000,
      }),
    );

    const [unico] = await estadoDe(invoiceIds);
    expect(unico.estado).toBe("PARTIAL");
    expect(unico.pagado).toBe(400_000);
  });

  it("lo que sobra se devuelve: no se inventa un comprobante", async () => {
    const { clientId } = await crearDeudor(ctx, "Sobra", [{ mora: 10, monto: 500_000 }]);

    const r = await prisma.$transaction((tx) =>
      allocateToInvoices(tx, {
        organizationId: ctx.organizationId,
        clientId,
        amount: 800_000,
      }),
    );

    expect(Number(r.allocated)).toBe(500_000);
    expect(Number(r.remaining)).toBe(300_000);
  });

  it("no toca comprobantes castigados ni refinanciados", async () => {
    // Ya salieron de la cartera activa. Imputarles un cobro los resucitaría como
    // deuda viva y volvería a inflar el saldo.
    const { clientId, invoiceIds } = await crearDeudor(ctx, "Cerrados", [
      { mora: 200, monto: 1_000_000, estado: "WRITTEN_OFF" },
      { mora: 150, monto: 1_000_000, estado: "REFINANCED" },
      { mora: 10, monto: 1_000_000 },
    ]);

    await prisma.$transaction((tx) =>
      allocateToInvoices(tx, {
        organizationId: ctx.organizationId,
        clientId,
        amount: 3_000_000,
      }),
    );

    const [castigado, refinanciado, abierto] = await estadoDe(invoiceIds);
    expect(castigado.pagado).toBe(0);
    expect(refinanciado.pagado).toBe(0);
    expect(abierto.estado).toBe("PAID");
  });
});

describe("refreshClientBalance", () => {
  async function refrescar(clientId: string) {
    await prisma.$transaction((tx) =>
      refreshClientBalance(tx, ctx.organizationId, clientId),
    );
    return prisma.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { totalDebt: true, status: true },
    });
  }

  it("el saldo suma solo lo abierto", async () => {
    const { clientId } = await crearDeudor(ctx, "Saldo", [
      { mora: 10, monto: 1_000_000, pagado: 250_000 },
      { mora: 20, monto: 2_000_000 },
      { mora: 300, monto: 9_000_000, estado: "WRITTEN_OFF" },
    ]);

    const cliente = await refrescar(clientId);
    expect(Number(cliente.totalDebt)).toBe(2_750_000);
  });

  it("castigarle todo lo deja Perdido, no Pagado", async () => {
    // Bug real: la regla era "sin comprobantes abiertos, entonces pagó", que es
    // justo el caso contrario de un deudor al que le castigaron la deuda.
    const { clientId } = await crearDeudor(ctx, "Castigado", [
      { mora: 300, monto: 5_000_000, estado: "WRITTEN_OFF" },
    ]);

    const cliente = await refrescar(clientId);
    expect(cliente.status).toBe("LOST");
    expect(Number(cliente.totalDebt)).toBe(0);
  });

  it("el castigo gana sobre el pago", async () => {
    // Pagó una deuda y le castigaron la otra: no cumplió.
    const { clientId } = await crearDeudor(ctx, "Mixto", [
      { mora: 40, monto: 1_000_000, pagado: 1_000_000, estado: "PAID" },
      { mora: 300, monto: 2_000_000, estado: "WRITTEN_OFF" },
    ]);

    expect((await refrescar(clientId)).status).toBe("LOST");
  });

  it("pagar todo sí lo deja Pagado", async () => {
    const { clientId } = await crearDeudor(ctx, "Pagador", [
      { mora: 10, monto: 1_000_000, pagado: 1_000_000, estado: "PAID" },
    ]);

    expect((await refrescar(clientId)).status).toBe("PAID");
  });

  it("con deuda abierta no cambia el estado que traía", async () => {
    const { clientId } = await crearDeudor(ctx, "Sigue", [{ mora: 10, monto: 1_000_000 }]);
    await prisma.client.update({ where: { id: clientId }, data: { status: "PROMISE" } });

    expect((await refrescar(clientId)).status).toBe("PROMISE");
  });
});
