import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getClientDetail } from "@/lib/queries/tasks";
import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearDeudor,
  crearOrganizacion,
  type Contexto,
} from "./fixtures";

/**
 * Referencias personales y cartera por comprobante.
 *
 * Las dos cosas existen para la misma pregunta del operador: "a quién llamo" y
 * "de qué cartera es esto que le estoy cobrando".
 */

let ctx: Contexto;

beforeEach(async () => {
  ctx = await crearOrganizacion("refs");
});

afterEach(async () => {
  if (ctx) await borrarOrganizacion(ctx.organizationId);
});

describe("referencias personales", () => {
  it("viajan a la ficha del deudor", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);

    await prisma.clientReference.createMany({
      data: [
        {
          organizationId: ctx.organizationId,
          clientId,
          name: "Ana Pérez",
          phone: "0981111111",
          relation: "Hermana",
        },
        {
          organizationId: ctx.organizationId,
          clientId,
          name: "Luis Gómez",
          relation: "Garante",
        },
      ],
    });

    const detalle = await getClientDetail(ctx.organizationId, clientId);
    expect(detalle?.references.map((r) => r.name)).toEqual(["Ana Pérez", "Luis Gómez"]);
    expect(detalle?.references[0]?.phone).toBe("0981111111");
    // Una referencia sin teléfono sigue sirviendo: el nombre y el vínculo son
    // lo que permite ubicarla después.
    expect(detalle?.references[1]?.phone).toBeNull();
  });

  it("se borran con el deudor, no quedan sueltas", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);
    await prisma.clientReference.create({
      data: { organizationId: ctx.organizationId, clientId, name: "Alguien" },
    });

    await prisma.client.delete({ where: { id: clientId } });

    expect(
      await prisma.clientReference.count({ where: { clientId } }),
    ).toBe(0);
  });

  it("no se filtran entre organizaciones", async () => {
    const otra = await crearOrganizacion("refs-ajena");
    try {
      const mio = await crearDeudor(ctx, "Propio", [{ mora: 5, monto: 500_000 }]);
      const suyo = await crearDeudor(otra, "Ajeno", [{ mora: 5, monto: 500_000 }]);

      await prisma.clientReference.create({
        data: { organizationId: otra.organizationId, clientId: suyo.clientId, name: "Ajena" },
      });

      const detalle = await getClientDetail(ctx.organizationId, mio.clientId);
      expect(detalle?.references).toHaveLength(0);

      // Y pedir el deudor ajeno desde mi organización no devuelve nada.
      expect(await getClientDetail(ctx.organizationId, suyo.clientId)).toBeNull();
    } finally {
      await borrarOrganizacion(otra.organizationId);
    }
  });
});

describe("cartera por comprobante", () => {
  it("lista las carteras con deuda abierta, sin repetir", async () => {
    const segunda = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Cartera prendaria" },
      select: { id: true },
    });

    const { clientId, invoiceIds } = await crearDeudor(ctx, "Dos carteras", [
      { mora: 30, monto: 1_000_000 },
      { mora: 60, monto: 2_000_000 },
      { mora: 90, monto: 3_000_000 },
    ]);

    // Las dos primeras quedan en la cartera del fixture, la tercera en la otra.
    await prisma.invoice.updateMany({
      where: { id: { in: invoiceIds.slice(0, 2) } },
      data: { portfolioId: ctx.portfolioId },
    });
    await prisma.invoice.update({
      where: { id: invoiceIds[2] },
      data: { portfolioId: segunda.id },
    });

    const detalle = await getClientDetail(ctx.organizationId, clientId);
    expect(detalle?.carteras).toHaveLength(2);
    expect(detalle?.carteras).toContain("Cartera prendaria");

    // Y cada comprobante sabe de cuál es.
    const tercero = detalle?.invoices.find((i) => i.id === invoiceIds[2]);
    expect(tercero?.portfolioName).toBe("Cartera prendaria");
  });

  it("una cartera sin deuda abierta no se lista", async () => {
    // La pregunta es "de qué cartera es lo que le estoy cobrando". Una cartera
    // ya cobrada no entra en esa conversación.
    const segunda = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Cartera vieja" },
      select: { id: true },
    });

    const { clientId, invoiceIds } = await crearDeudor(ctx, "Una viva", [
      { mora: 30, monto: 1_000_000 },
      { mora: 200, monto: 5_000_000, estado: "PAID" },
    ]);

    await prisma.invoice.update({
      where: { id: invoiceIds[0] },
      data: { portfolioId: ctx.portfolioId },
    });
    await prisma.invoice.update({
      where: { id: invoiceIds[1] },
      data: { portfolioId: segunda.id },
    });

    const detalle = await getClientDetail(ctx.organizationId, clientId);
    expect(detalle?.carteras).not.toContain("Cartera vieja");
    expect(detalle?.carteras).toHaveLength(1);
  });

  it("borrar una cartera no borra sus comprobantes", async () => {
    // El FK es SET NULL: la deuda sobrevive aunque se elimine la cartera, que
    // es lo correcto — la plata sigue debiéndose.
    const otra = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Efímera" },
      select: { id: true },
    });

    const { invoiceIds } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);
    await prisma.invoice.update({
      where: { id: invoiceIds[0] },
      data: { portfolioId: otra.id },
    });

    await prisma.portfolio.delete({ where: { id: otra.id } });

    const comprobante = await prisma.invoice.findUnique({
      where: { id: invoiceIds[0] },
      select: { id: true, portfolioId: true },
    });
    expect(comprobante).not.toBeNull();
    expect(comprobante?.portfolioId).toBeNull();
  });
});
