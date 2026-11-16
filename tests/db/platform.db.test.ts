import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPlatformTotals, listTenants } from "@/lib/platform/queries";
import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearCobro,
  crearDeudor,
  crearOrganizacion,
  type Contexto,
} from "./fixtures";

/**
 * Las consultas del backoffice.
 *
 * Son las únicas del producto que a propósito NO filtran por organización, así
 * que lo que hay que probar es lo contrario que en el resto: que efectivamente
 * vean todo, y que lo que informan de cada empresa sea lo de esa empresa y no
 * una suma mezclada.
 */

let una: Contexto;
let otra: Contexto;

beforeAll(async () => {
  una = await crearOrganizacion("bo-una");
  otra = await crearOrganizacion("bo-otra");

  // Una empresa con cartera y actividad.
  const d1 = await crearDeudor(una, "Deudor A", [
    { mora: 30, monto: 1_000_000 },
    { mora: 60, monto: 2_000_000, pagado: 500_000 },
    { mora: 90, monto: 9_000_000, estado: "WRITTEN_OFF" },
  ]);
  await crearCobro(una, d1.clientId, { monto: 300_000, hace: 2 });

  // Otra con mucha más plata, para que una suma mal filtrada se note.
  for (let i = 0; i < 3; i += 1) {
    await crearDeudor(otra, `Deudor ajeno ${i}`, [{ mora: 10, monto: 40_000_000 }]);
  }
}, 180_000);

afterAll(async () => {
  await borrarOrganizacion(una.organizationId);
  await borrarOrganizacion(otra.organizationId);
});

function fila(tenants: Awaited<ReturnType<typeof listTenants>>, id: string) {
  const encontrada = tenants.find((t) => t.id === id);
  expect(encontrada, "la empresa tiene que aparecer en el listado").toBeDefined();
  return encontrada!;
}

describe("listTenants", () => {
  it("ve todas las empresas, no solo una", async () => {
    const tenants = await listTenants();
    const ids = tenants.map((t) => t.id);
    expect(ids).toContain(una.organizationId);
    expect(ids).toContain(otra.organizationId);
  });

  it("el consumo de cada empresa es el suyo", async () => {
    const tenants = await listTenants();

    const a = fila(tenants, una.organizationId);
    expect(a.deudores).toBe(1);
    expect(a.usuarios).toBe(2); // el admin y el operador del fixture
    // 1.000.000 + (2.000.000 - 500.000). Los 9.000.000 castigados no son cartera.
    expect(a.carteraAbierta).toBe(2_500_000);

    const b = fila(tenants, otra.organizationId);
    expect(b.deudores).toBe(3);
    expect(b.carteraAbierta).toBe(120_000_000);
  });

  it("la última actividad sale del cobro o la gestión más reciente", async () => {
    const tenants = await listTenants();
    // La primera tuvo un cobro hace dos días.
    expect(fila(tenants, una.organizationId).ultimaActividad).toBeTruthy();
    // La segunda no tuvo ninguna: es la señal de una cuenta que no se usa.
    expect(fila(tenants, otra.organizationId).ultimaActividad).toBeNull();
  });

  it("informa el estado de suspensión", async () => {
    await prisma.organization.update({
      where: { id: otra.organizationId },
      data: { suspendedAt: new Date() },
    });

    const tenants = await listTenants();
    expect(fila(tenants, otra.organizationId).suspendedAt).toBeTruthy();
    expect(fila(tenants, una.organizationId).suspendedAt).toBeNull();

    await prisma.organization.update({
      where: { id: otra.organizationId },
      data: { suspendedAt: null },
    });
  });
});

describe("getPlatformTotals", () => {
  it("suma a través de todas las empresas", async () => {
    const totales = await getPlatformTotals();
    const tenants = await listTenants();

    expect(totales.organizaciones).toBe(tenants.length);
    // Los totales tienen que cubrir al menos lo de los dos fixtures.
    expect(totales.deudores).toBeGreaterThanOrEqual(4);
    expect(totales.carteraAbierta).toBeGreaterThanOrEqual(122_500_000);
  });

  it("el total de cartera no cuenta lo castigado", async () => {
    const tenants = await listTenants();
    const sumaPorEmpresa = tenants.reduce((sum, t) => sum + t.carteraAbierta, 0);
    const totales = await getPlatformTotals();

    // Si una de las dos contara el castigo y la otra no, estos números no
    // coincidirían: es la forma de verificar que usan el mismo criterio.
    expect(totales.carteraAbierta).toBeCloseTo(sumaPorEmpresa, 2);
  });
});

describe("suspensión", () => {
  it("no borra nada: los datos de la empresa quedan enteros", async () => {
    await prisma.organization.update({
      where: { id: una.organizationId },
      data: { suspendedAt: new Date() },
    });

    const tenants = await listTenants();
    const a = fila(tenants, una.organizationId);
    expect(a.deudores).toBe(1);
    expect(a.carteraAbierta).toBe(2_500_000);
    expect(a.usuarios).toBe(2);

    await prisma.organization.update({
      where: { id: una.organizationId },
      data: { suspendedAt: null },
    });
    expect(fila(await listTenants(), una.organizationId).suspendedAt).toBeNull();
  });
});
