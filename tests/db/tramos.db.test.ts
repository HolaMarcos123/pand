import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TRAMOS_ACTIVOS, type Tramo } from "@/lib/collections/tramos";
import { getClients } from "@/lib/queries/clients";
import { getKpis, getTranches } from "@/lib/queries/dashboard";

import { borrarOrganizacion, crearDeudor, crearOrganizacion, type Contexto } from "./fixtures";

/**
 * Los tramos, contra la base.
 *
 * Los tests unitarios ya fijan la función de TypeScript. Acá se prueba la otra
 * mitad: la expresión SQL que filtra. Son dos implementaciones de la misma regla
 * y el riesgo real es que digan cosas distintas — que es exactamente el bug #2
 * del QA de CobrAI.
 */

let ctx: Contexto;

const ESPERADO: Record<string, Tramo> = {
  "Al dia": "AL_DIA",
  "Quince dias": "T1_30",
  "Cuarenta dias": "T31_60",
  "Setenta dias": "T61_90",
  "Ciento veinte dias": "PRE_LEGAL",
  "Trescientos dias": "LEGAL",
  "Todo castigado": "CASTIGO",
  "Varias deudas": "LEGAL",
};

beforeAll(async () => {
  ctx = await crearOrganizacion("tramos");

  await crearDeudor(ctx, "Al dia", [{ mora: 0, monto: 1_000_000 }]);
  await crearDeudor(ctx, "Quince dias", [{ mora: 15, monto: 2_000_000 }]);
  await crearDeudor(ctx, "Cuarenta dias", [{ mora: 40, monto: 3_000_000 }]);
  await crearDeudor(ctx, "Setenta dias", [{ mora: 70, monto: 4_000_000 }]);
  await crearDeudor(ctx, "Ciento veinte dias", [{ mora: 120, monto: 5_000_000 }]);
  await crearDeudor(ctx, "Trescientos dias", [{ mora: 300, monto: 6_000_000 }]);

  // Sin nada abierto, solo castigado: tiene que ser Castigo y no "Al día".
  await crearDeudor(ctx, "Todo castigado", [
    { mora: 200, monto: 7_000_000, estado: "WRITTEN_OFF" },
  ]);

  // Con varias deudas manda la peor, no la última ni el promedio.
  await crearDeudor(ctx, "Varias deudas", [
    { mora: 5, monto: 1_000_000 },
    { mora: 250, monto: 2_000_000 },
    { mora: 60, monto: 3_000_000 },
  ]);
}, 180_000);

afterAll(async () => {
  await borrarOrganizacion(ctx.organizationId);
});

describe("filtro por tramo", () => {
  it("cada deudor cae en el tramo que le corresponde", async () => {
    const { rows, total } = await getClients(
      ctx.organizationId,
      ctx.adminId,
      "ADMIN",
      {},
      1,
    );

    expect(total).toBe(Object.keys(ESPERADO).length);
    for (const row of rows) {
      expect(row.tramo, `tramo de ${row.name}`).toBe(ESPERADO[row.name]);
    }
  });

  it("el filtro SQL y la columna coinciden, tramo por tramo", async () => {
    // Si discreparan, filtrar por "61-90" traería filas que la tabla dibuja en
    // otro tramo. Es el tipo de inconsistencia que un gerente detecta enseguida.
    for (const tramo of [...TRAMOS_ACTIVOS, "CASTIGO" as const]) {
      const { rows, total } = await getClients(
        ctx.organizationId,
        ctx.adminId,
        "ADMIN",
        { tramo },
        1,
      );

      const esperados = Object.entries(ESPERADO)
        .filter(([, t]) => t === tramo)
        .map(([nombre]) => nombre);

      expect(total, `total de ${tramo}`).toBe(esperados.length);
      expect(rows.map((r) => r.name).sort()).toEqual(esperados.sort());
    }
  });

  it("los tramos particionan la cartera: ni huecos ni repetidos", async () => {
    const sinFiltro = await getClients(ctx.organizationId, ctx.adminId, "ADMIN", {}, 1);

    let suma = 0;
    for (const tramo of [...TRAMOS_ACTIVOS, "CASTIGO" as const]) {
      const r = await getClients(ctx.organizationId, ctx.adminId, "ADMIN", { tramo }, 1);
      suma += r.total;
    }

    expect(suma).toBe(sinFiltro.total);
  });
});

describe("el castigo no infla la cartera activa", () => {
  it("el gráfico de tramos deja afuera lo castigado", async () => {
    const tramos = await getTranches(ctx.organizationId);
    const total = tramos.reduce((sum, t) => sum + t.amount, 0);

    // 1+2+3+4+5+6 de los deudores de una deuda, más 1+2+3 del de varias.
    // Los 7.000.000 castigados NO entran.
    expect(total).toBe(27_000_000);
    expect(tramos.some((t) => t.key === ("CASTIGO" as Tramo))).toBe(false);
  });

  it("el castigo se informa aparte, en su propio KPI", async () => {
    const kpis = await getKpis(ctx.organizationId);
    expect(kpis.writtenOffAmount).toBe(7_000_000);
    expect(kpis.openDebt).toBe(27_000_000);
  });
});
