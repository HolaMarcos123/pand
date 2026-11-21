import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionData } from "@/lib/auth/session";
import { resolverSettings } from "@/lib/config/settings";
import { BATCH_SIZE, type MappedRow } from "@/lib/import/row-schema";
import { getClients } from "@/lib/queries/clients";
import { getClientDetail } from "@/lib/queries/tasks";
import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearOrganizacion,
  type Contexto,
} from "./fixtures";

/**
 * El importador de carteras.
 *
 * Esto escribe la cartera real de un cliente de Pand, así que lo que se fija acá
 * no es "que ande": es que reimportar **corrija** en vez de duplicar, que no se
 * pierdan filas, y que no se pise el trabajo que un operador ya hizo sobre un
 * deudor que vuelve a aparecer en una planilla nueva.
 *
 * El importador escribe el lote entero en unas pocas sentencias masivas en vez
 * de un upsert por fila. Eso lo hace 36 veces más rápido y mete una trampa que
 * el bucle anterior no tenía: `ON CONFLICT DO UPDATE` se cae si la misma llave
 * aparece dos veces en una sentencia, y en una cartera el mismo deudor aparece
 * una vez por cada cuota que debe. El test "un deudor con varias cuotas" es
 * justamente ese caso, y no es un borde: es la forma normal de una cartera.
 */

let ctx: Contexto;
let sesion: SessionData;

// El importador es un server action: saca organización y rol de la sesión, no de
// sus argumentos. Se simula para poder probarlo contra la base de verdad.
vi.mock("@/lib/auth/session", () => ({
  requireSession: () => Promise.resolve(sesion),
}));

// `finalizePortfolio` invalida el cache de Next, que fuera de un request no
// existe. No es parte de lo que se prueba acá.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { importBatch, finalizePortfolio } = await import("@/lib/import/actions");

function sesionDe(ctx: Contexto, role: "ADMIN" | "OPERATOR" = "ADMIN"): SessionData {
  // Los settings salen del resolvedor de verdad en vez de escribirse a mano: si
  // mañana la sesión lleva un campo más, este test no miente sobre su forma.
  const settings = resolverSettings(undefined);

  return {
    user: {
      id: role === "ADMIN" ? ctx.adminId : ctx.operadorId,
      email: "quien@pand.demo",
      fullName: "Quien Importa",
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

/** Una fila mapeada, con lo mínimo y lo que el test quiera encima. */
function fila(over: Partial<MappedRow> & Pick<MappedRow, "externalId" | "invoiceNumber">): MappedRow {
  return {
    name: `Deudor ${over.externalId}`,
    documentNumber: null,
    email: null,
    phone: null,
    phoneAlt: null,
    product: null,
    amount: 1_000_000,
    dueDate: "2026-08-15",
    currency: null,
    description: null,
    referenceName: null,
    referencePhone: null,
    referenceRelation: null,
    ...over,
  } as MappedRow;
}

beforeEach(async () => {
  ctx = await crearOrganizacion("import");
  sesion = sesionDe(ctx);
});

afterEach(async () => {
  if (ctx) await borrarOrganizacion(ctx.organizationId);
});

describe("escritura del lote", () => {
  it("escribe deudores y comprobantes, y los cuenta", async () => {
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1" }),
        fila({ externalId: "C-2", invoiceNumber: "F-2" }),
      ],
    });

    expect(res).toEqual({ ok: true, clients: 2, invoices: 2 });

    const deudores = await prisma.client.count({
      where: { organizationId: ctx.organizationId },
    });
    expect(deudores).toBe(2);
    expect(
      await prisma.invoice.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(2);
  });

  it("un deudor con varias cuotas: un solo deudor, todos los comprobantes", async () => {
    // El caso que rompe `ON CONFLICT DO UPDATE` si no se deduplica antes: el
    // mismo external_id tres veces en la misma sentencia.
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 100_000 }),
        fila({ externalId: "C-1", invoiceNumber: "F-2", amount: 200_000 }),
        fila({ externalId: "C-1", invoiceNumber: "F-3", amount: 300_000 }),
      ],
    });

    expect(res).toEqual({ ok: true, clients: 1, invoices: 3 });

    const deudor = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { id: true, _count: { select: { invoices: true } } },
    });
    expect(deudor?._count.invoices).toBe(3);
  });

  it("no pierde ninguna fila de un lote lleno", async () => {
    // Un lote del tamaño máximo, con dos cuotas por deudor: el external_id de
    // cada uno viene repetido. Si la deduplicación o alguno de los `unnest` se
    // desalinearan por una fila, acá se ve.
    const deudores = BATCH_SIZE / 2;
    const rows: MappedRow[] = [];
    for (let i = 0; i < deudores; i += 1) {
      rows.push(fila({ externalId: `C-${i}`, invoiceNumber: `F-${i}-a` }));
      rows.push(fila({ externalId: `C-${i}`, invoiceNumber: `F-${i}-b` }));
    }
    expect(rows).toHaveLength(BATCH_SIZE);

    const res = await importBatch({ portfolioId: ctx.portfolioId, rows });
    expect(res).toEqual({ ok: true, clients: deudores, invoices: BATCH_SIZE });

    expect(
      await prisma.client.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(deudores);
    expect(
      await prisma.invoice.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(BATCH_SIZE);
  });

  it("un cuotero: dos deudores con la cuota 1/60 son dos deudas", async () => {
    // El caso que costó una cartera real. En un cuotero la columna del
    // comprobante es "1/60" y la tienen todos los deudores. Mientras el número
    // fue único por organización, estas dos filas se colapsaban en un solo
    // comprobante atribuido al último deudor, y el primero quedaba sin deuda.
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "1/60", amount: 500_000 }),
        fila({ externalId: "C-2", invoiceNumber: "1/60", amount: 700_000 }),
        fila({ externalId: "C-1", invoiceNumber: "2/60", amount: 500_000 }),
        fila({ externalId: "C-2", invoiceNumber: "2/60", amount: 700_000 }),
      ],
    });

    expect(res).toEqual({ ok: true, clients: 2, invoices: 4 });

    // Cada deudor con sus dos cuotas, y ninguno sin deuda.
    for (const [externalId, monto] of [
      ["C-1", 500_000],
      ["C-2", 700_000],
    ] as const) {
      const deudor = await prisma.client.findFirst({
        where: { organizationId: ctx.organizationId, externalId },
        select: {
          invoices: {
            select: { invoiceNumber: true, amount: true },
            orderBy: { invoiceNumber: "asc" },
          },
        },
      });
      expect(deudor?.invoices.map((i) => i.invoiceNumber)).toEqual(["1/60", "2/60"]);
      // Y con SU monto, no el del otro.
      expect(deudor?.invoices.every((i) => Number(i.amount) === monto)).toBe(true);
    }
  });

  it("el mismo deudor con la misma cuota dos veces y montos distintos se rechaza", async () => {
    // Acá no hay forma de elegir sin perder una deuda, así que no se elige:
    // se rechaza el lote y se dice de quién es el comprobante.
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "1/60", amount: 500_000 }),
        fila({ externalId: "C-1", invoiceNumber: "1/60", amount: 900_000 }),
      ],
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toContain("C-1");
    expect(res.error).toContain("1/60");

    // Y no quedó nada escrito.
    expect(
      await prisma.client.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(0);
  });

  it("la misma fila repetida en la planilla no molesta", async () => {
    // Una planilla puede traer la fila duplicada tal cual. Si describe la misma
    // deuda, se deduplica y entra una vez: eso no es perder nada.
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "1/60", amount: 500_000 }),
        fila({ externalId: "C-1", invoiceNumber: "1/60", amount: 500_000 }),
      ],
    });

    expect(res).toEqual({ ok: true, clients: 1, invoices: 1 });
  });

  it("rechaza un lote más grande que el máximo", async () => {
    const rows = Array.from({ length: BATCH_SIZE + 1 }, (_, i) =>
      fila({ externalId: `C-${i}`, invoiceNumber: `F-${i}` }),
    );

    const res = await importBatch({ portfolioId: ctx.portfolioId, rows });
    expect(res.ok).toBe(false);
  });

  it("guarda monto y vencimiento sin deformarlos", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({
          externalId: "C-1",
          invoiceNumber: "F-1",
          amount: 1_234_567.89,
          dueDate: "2026-10-01",
        }),
      ],
    });

    const comprobante = await prisma.invoice.findFirst({
      where: { organizationId: ctx.organizationId, invoiceNumber: "F-1" },
      select: { amount: true, dueDate: true },
    });

    expect(Number(comprobante?.amount)).toBe(1_234_567.89);
    // El 1 de octubre tiene que seguir siendo el 1 de octubre: la columna es
    // `date`, y una conversión de zona horaria lo correría un día.
    expect(comprobante?.dueDate.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("escribe las filas en la cartera del lote", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1" })],
    });

    const comprobante = await prisma.invoice.findFirst({
      where: { organizationId: ctx.organizationId, invoiceNumber: "F-1" },
      select: { portfolioId: true },
    });
    expect(comprobante?.portfolioId).toBe(ctx.portfolioId);
  });
});

describe("moneda", () => {
  it("guarda la moneda que trae la fila", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "1/12", amount: 500, currency: "USD" }),
        fila({ externalId: "C-2", invoiceNumber: "1/12", amount: 3_500_000, currency: "PYG" }),
      ],
    });

    const comprobantes = await prisma.invoice.findMany({
      where: { organizationId: ctx.organizationId },
      select: { currency: true, amount: true },
      orderBy: { amount: "asc" },
    });

    expect(comprobantes.map((c) => c.currency)).toEqual(["USD", "PYG"]);
  });

  it("sin moneda en la fila usa la de la organización", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "1/12" })],
    });

    const c = await prisma.invoice.findFirst({
      where: { organizationId: ctx.organizationId },
      select: { currency: true },
    });
    expect(c?.currency).toBe("PYG");
  });

  it("un deudor puede deber en dos monedas sin que se sumen", async () => {
    // 500 dólares y 500.000 guaraníes no son 500.500 de nada. La lista informa
    // la moneda principal —la que concentra más saldo— con su propio total, y
    // avisa que hay otra.
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "USD-1/12", amount: 500, currency: "USD" }),
        fila({ externalId: "C-1", invoiceNumber: "PYG-1/12", amount: 500_000, currency: "PYG" }),
      ],
    });
    await finalizePortfolio(ctx.portfolioId);

    const detalle = await getClientDetail(
      ctx.organizationId,
      (await prisma.client.findFirstOrThrow({
        where: { organizationId: ctx.organizationId, externalId: "C-1" },
        select: { id: true },
      })).id,
    );

    // La ficha los muestra separados, de mayor a menor saldo.
    expect(detalle?.saldos).toHaveLength(2);
    const porMoneda = new Map(detalle?.saldos.map((s) => [s.currency, s.total]));
    expect(porMoneda.get("USD")).toBe(500);
    expect(porMoneda.get("PYG")).toBe(500_000);

    // Y la lista informa la principal por saldo —guaraníes— con SU total, no la
    // suma de las dos.
    const { rows: lista } = await getClients(
      ctx.organizationId,
      ctx.adminId,
      "ADMIN",
      {},
      1,
    );
    const row = lista.find((r) => r.externalId === "C-1");
    expect(row?.moneda).toBe("PYG");
    expect(row?.totalDebt).toBe(500_000);
    expect(row?.monedas).toBe(2);
  });
});

describe("reimportar la misma planilla", () => {
  it("corrige los datos en vez de duplicar cartera", async () => {
    const primera = [
      fila({ externalId: "C-1", invoiceNumber: "F-1", name: "Juan Perez", amount: 500_000 }),
    ];
    await importBatch({ portfolioId: ctx.portfolioId, rows: primera });

    // La segunda planilla trae el nombre corregido y otro monto.
    const segunda = [
      fila({
        externalId: "C-1",
        invoiceNumber: "F-1",
        name: "Juan Pérez González",
        amount: 750_000,
        phone: "0981222333",
      }),
    ];
    const res = await importBatch({ portfolioId: ctx.portfolioId, rows: segunda });

    // Ningún deudor nuevo: ya existía.
    expect(res).toEqual({ ok: true, clients: 0, invoices: 1 });

    expect(
      await prisma.client.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.invoice.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(1);

    const deudor = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { name: true, phone: true },
    });
    expect(deudor?.name).toBe("Juan Pérez González");
    expect(deudor?.phone).toBe("0981222333");

    const comprobante = await prisma.invoice.findFirst({
      where: { organizationId: ctx.organizationId, invoiceNumber: "F-1" },
      select: { amount: true },
    });
    expect(Number(comprobante?.amount)).toBe(750_000);
  });

  it("no pisa la cartera ni el estado de gestión del deudor", async () => {
    // Lo que protege esto: el deudor vino en una cartera, un operador lo
    // trabajó, y después aparece en una planilla nueva. Reimportar corrige sus
    // datos de contacto, pero no lo saca de donde está ni le borra el avance.
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1" })],
    });

    await prisma.client.updateMany({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      data: { status: "IN_PROGRESS", assignedToId: ctx.operadorId },
    });

    const otraCartera = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Cartera nueva" },
      select: { id: true },
    });

    await importBatch({
      portfolioId: otraCartera.id,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-2", name: "Nombre corregido" })],
    });

    const deudor = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { name: true, status: true, assignedToId: true, portfolioId: true },
    });

    expect(deudor?.name).toBe("Nombre corregido");
    expect(deudor?.status).toBe("IN_PROGRESS");
    expect(deudor?.assignedToId).toBe(ctx.operadorId);
    // Sigue en la cartera original.
    expect(deudor?.portfolioId).toBe(ctx.portfolioId);

    // Pero el comprobante nuevo sí queda en la cartera nueva.
    const nuevo = await prisma.invoice.findFirst({
      where: { organizationId: ctx.organizationId, invoiceNumber: "F-2" },
      select: { portfolioId: true },
    });
    expect(nuevo?.portfolioId).toBe(otraCartera.id);
  });
});

describe("referencias personales", () => {
  it("se deduplican por deudor: la planilla las repite en cada cuota", async () => {
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({
          externalId: "C-1",
          invoiceNumber: "F-1",
          referenceName: "Ana Pérez",
          referencePhone: "0981111111",
          referenceRelation: "Hermana",
        }),
        fila({
          externalId: "C-1",
          invoiceNumber: "F-2",
          referenceName: "Ana Pérez",
          referencePhone: "0981111111",
          referenceRelation: "Hermana",
        }),
        fila({
          externalId: "C-1",
          invoiceNumber: "F-3",
          referenceName: "Ana Pérez",
          referencePhone: "0981111111",
          referenceRelation: "Hermana",
        }),
      ],
    });
    expect(res.ok).toBe(true);

    const refs = await prisma.clientReference.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true, phone: true, relation: true },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      name: "Ana Pérez",
      phone: "0981111111",
      relation: "Hermana",
    });
  });

  it("al reimportar actualiza el teléfono, no crea otra", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({
          externalId: "C-1",
          invoiceNumber: "F-1",
          referenceName: "Ana Pérez",
          referencePhone: "0981111111",
        }),
      ],
    });

    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({
          externalId: "C-1",
          invoiceNumber: "F-1",
          referenceName: "Ana Pérez",
          referencePhone: "0982999999",
          referenceRelation: "Hermana",
        }),
      ],
    });

    const refs = await prisma.clientReference.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true, phone: true, relation: true },
    });
    expect(refs).toHaveLength(1);
    expect(refs[0]?.phone).toBe("0982999999");
    expect(refs[0]?.relation).toBe("Hermana");
  });

  it("dos deudores pueden tener una referencia del mismo nombre", async () => {
    // No hay unique sobre el nombre a propósito: dos personas distintas pueden
    // llamarse igual. La deduplicación es por deudor, no global.
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1", referenceName: "María López" }),
        fila({ externalId: "C-2", invoiceNumber: "F-2", referenceName: "María López" }),
      ],
    });

    const refs = await prisma.clientReference.findMany({
      where: { organizationId: ctx.organizationId },
      select: { clientId: true, name: true },
    });
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((r) => r.clientId)).size).toBe(2);
  });

  it("un deudor puede tener varias referencias distintas", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1", referenceName: "Ana Pérez" }),
        fila({ externalId: "C-1", invoiceNumber: "F-2", referenceName: "Luis Gómez" }),
      ],
    });

    const refs = await prisma.clientReference.findMany({
      where: { organizationId: ctx.organizationId },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    expect(refs.map((r) => r.name)).toEqual(["Ana Pérez", "Luis Gómez"]);
  });

  it("una fila sin referencia no crea nada", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1" })],
    });

    expect(
      await prisma.clientReference.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(0);
  });
});

describe("permisos y aislamiento", () => {
  it("un operador no puede cargar cartera", async () => {
    sesion = sesionDe(ctx, "OPERATOR");

    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1" })],
    });

    expect(res.ok).toBe(false);
    expect(
      await prisma.client.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(0);
  });

  it("no se puede escribir en la cartera de otra organización", async () => {
    // Prisma corre con BYPASSRLS, así que esto lo sostiene el chequeo del
    // código y nada más. Si se cae, un tenant escribe en otro.
    const otra = await crearOrganizacion("import-ajena");
    try {
      const res = await importBatch({
        portfolioId: otra.portfolioId,
        rows: [fila({ externalId: "C-1", invoiceNumber: "F-1" })],
      });

      expect(res.ok).toBe(false);
      expect(
        await prisma.client.count({ where: { organizationId: otra.organizationId } }),
      ).toBe(0);
    } finally {
      await borrarOrganizacion(otra.organizationId);
    }
  });

  it("no se puede cargar en una cartera cerrada", async () => {
    await prisma.portfolio.update({
      where: { id: ctx.portfolioId },
      data: { status: "CLOSED" },
    });

    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1" })],
    });
    expect(res.ok).toBe(false);
  });

  it("el lote entero se revierte si una fila es inválida", async () => {
    // El monto negativo lo rechaza zod antes de tocar la base, pero lo que se
    // fija es que no quede media cartera escrita.
    const res = await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1" }),
        fila({ externalId: "C-2", invoiceNumber: "F-2", amount: -5 }),
      ],
    });

    expect(res.ok).toBe(false);
    expect(
      await prisma.client.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(0);
  });
});

describe("cierre de la carga", () => {
  it("total_debt del deudor queda en la suma de sus comprobantes abiertos", async () => {
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 300_000 }),
        fila({ externalId: "C-1", invoiceNumber: "F-2", amount: 700_000 }),
      ],
    });

    const res = await finalizePortfolio(ctx.portfolioId);
    expect(res.ok).toBe(true);

    const deudor = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { totalDebt: true },
    });
    expect(Number(deudor?.totalDebt)).toBe(1_000_000);

    const cartera = await prisma.portfolio.findUnique({
      where: { id: ctx.portfolioId },
      select: { status: true, totalClients: true, totalAmount: true },
    });
    expect(cartera?.status).toBe("ACTIVE");
    expect(cartera?.totalClients).toBe(1);
    expect(Number(cartera?.totalAmount)).toBe(1_000_000);
  });

  it("reimportar en otra cartera deja las dos con números ciertos", async () => {
    // Este es el caso que se veía mal en pantalla: al reimportar, el deudor se
    // queda a propósito en su cartera original y el comprobante se muda a la
    // nueva. Contando los deudores por client.portfolio_id, la cartera nueva
    // mostraba "0 deudores" teniendo todos los comprobantes, y la vieja mostraba
    // sus deudores de siempre sin un guaraní de deuda.
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 400_000 })],
    });
    await finalizePortfolio(ctx.portfolioId);

    const nueva = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Cartera corregida" },
      select: { id: true },
    });

    await importBatch({
      portfolioId: nueva.id,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 900_000 })],
    });
    await finalizePortfolio(nueva.id);

    const vieja = await prisma.portfolio.findUnique({
      where: { id: ctx.portfolioId },
      select: { totalClients: true, totalAmount: true },
    });
    const actual = await prisma.portfolio.findUnique({
      where: { id: nueva.id },
      select: { totalClients: true, totalAmount: true },
    });

    // La nueva tiene el comprobante, así que tiene el deudor y el monto.
    expect(actual?.totalClients).toBe(1);
    expect(Number(actual?.totalAmount)).toBe(900_000);

    // Y la vieja, que se quedó sin comprobantes, va a cero en vez de conservar
    // los totales de su propia carga.
    expect(vieja?.totalClients).toBe(0);
    expect(Number(vieja?.totalAmount)).toBe(0);
  });

  it("recalcula la deuda del deudor reimportado aunque esté en otra cartera", async () => {
    // El bug grave detrás del contador: el recálculo filtraba por
    // client.portfolio_id, así que al reimportar en una cartera nueva la deuda
    // del deudor no se tocaba. Quedaba la planilla nueva escrita y el total
    // viejo intacto.
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 400_000 })],
    });
    await finalizePortfolio(ctx.portfolioId);

    const nueva = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Segunda carga" },
      select: { id: true },
    });

    // Misma deuda corregida a 900.000, más una cuota nueva.
    await importBatch({
      portfolioId: nueva.id,
      rows: [
        fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 900_000 }),
        fila({ externalId: "C-1", invoiceNumber: "F-2", amount: 100_000 }),
      ],
    });
    await finalizePortfolio(nueva.id);

    const deudor = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { totalDebt: true, portfolioId: true },
    });

    // Sigue en su cartera original...
    expect(deudor?.portfolioId).toBe(ctx.portfolioId);
    // ...pero su deuda está al día.
    expect(Number(deudor?.totalDebt)).toBe(1_000_000);
  });

  it("un deudor sin comprobantes abiertos queda en cero", async () => {
    // Antes esto no pasaba: el agregado usaba un JOIN interno sobre los
    // comprobantes abiertos, así que un deudor que no tenía ninguno no llegaba a
    // la consulta y conservaba su deuda anterior. El COALESCE no lo cubría,
    // porque no llegaba una fila en cero: no llegaba ninguna.
    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 500_000 })],
    });
    await finalizePortfolio(ctx.portfolioId);

    const antes = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { totalDebt: true },
    });
    expect(Number(antes?.totalDebt)).toBe(500_000);

    // El comprobante se cobra y se vuelve a cerrar la carga.
    await prisma.invoice.updateMany({
      where: { organizationId: ctx.organizationId, invoiceNumber: "F-1" },
      data: { status: "PAID", paidAmount: 500_000 },
    });
    await finalizePortfolio(ctx.portfolioId);

    const despues = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { totalDebt: true },
    });
    expect(Number(despues?.totalDebt)).toBe(0);

    // Y la cartera, que sigue teniendo el comprobante pero ya cobrado, informa
    // su deudor con monto cero.
    const cartera = await prisma.portfolio.findUnique({
      where: { id: ctx.portfolioId },
      select: { totalClients: true, totalAmount: true },
    });
    expect(cartera?.totalClients).toBe(1);
    expect(Number(cartera?.totalAmount)).toBe(0);
  });

  it("el monto de una cartera es el de sus comprobantes, sin contar dos veces", async () => {
    // Un deudor que debe en dos carteras tiene una sola total_debt, que es toda
    // su deuda. Sumar esa cifra en las dos carteras inflaba las dos; ahora cada
    // una informa lo suyo y los totales se pueden sumar.
    const otra = await prisma.portfolio.create({
      data: { organizationId: ctx.organizationId, name: "Prendaria" },
      select: { id: true },
    });

    await importBatch({
      portfolioId: ctx.portfolioId,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-1", amount: 300_000 })],
    });
    await importBatch({
      portfolioId: otra.id,
      rows: [fila({ externalId: "C-1", invoiceNumber: "F-2", amount: 700_000 })],
    });
    await finalizePortfolio(otra.id);

    const a = await prisma.portfolio.findUnique({
      where: { id: ctx.portfolioId },
      select: { totalAmount: true, totalClients: true },
    });
    const b = await prisma.portfolio.findUnique({
      where: { id: otra.id },
      select: { totalAmount: true, totalClients: true },
    });

    expect(Number(a?.totalAmount)).toBe(300_000);
    expect(Number(b?.totalAmount)).toBe(700_000);
    expect(a?.totalClients).toBe(1);
    expect(b?.totalClients).toBe(1);

    // El deudor, en cambio, debe el total de las dos.
    const deudor = await prisma.client.findFirst({
      where: { organizationId: ctx.organizationId, externalId: "C-1" },
      select: { totalDebt: true },
    });
    expect(Number(deudor?.totalDebt)).toBe(1_000_000);
  });
});
