import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getClients, getProductOptions, getSegments } from "@/lib/queries/clients";
import { getKpis, getOperatorStats, getTranches } from "@/lib/queries/dashboard";
import {
  getContactability,
  getPromises,
  getRecovery,
} from "@/lib/queries/reports";
import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearCobro,
  crearDeudor,
  crearOrganizacion,
  crearPromesa,
  fechaIso,
  type Contexto,
} from "./fixtures";

/**
 * Aislamiento entre organizaciones.
 *
 * Esto es lo más importante que prueban estos tests, y conviene decir por qué:
 * Prisma se conecta como `postgres`, que tiene BYPASSRLS. Las policies de RLS
 * **no corren** para las consultas de la aplicación. Lo único que separa a un
 * cliente de otro es el `organization_id` escrito a mano en cada consulta.
 *
 * O sea: un WHERE olvidado no lo ataja nada. Por eso cada consulta que sirve
 * datos de una organización se prueba acá contra una segunda organización con
 * datos propios, y no contra una organización vacía: una consulta rota devuelve
 * las dos carteras, y contra una base vacía eso no se nota.
 */

let propia: Contexto;
let ajena: Contexto;
const PERIODO = { from: fechaIso(-60), to: fechaIso(60) };

beforeAll(async () => {
  propia = await crearOrganizacion("propia");
  ajena = await crearOrganizacion("ajena");

  const mio = await crearDeudor(propia, "Deudor propio", [
    { mora: 40, monto: 1_000_000, producto: "Crédito propio" },
  ]);
  await crearCobro(propia, mio.clientId, { monto: 100_000, hace: 5 });
  await crearPromesa(propia, mio.clientId, { monto: 500_000, venceEn: -5, cargadaHace: 10 });

  // La organización ajena tiene MÁS plata y MÁS deudores: si una consulta se
  // filtra mal, los números se disparan y el test lo ve.
  for (let i = 0; i < 4; i += 1) {
    const suyo = await crearDeudor(ajena, `Deudor ajeno ${i}`, [
      { mora: 200, monto: 50_000_000, producto: "Crédito ajeno" },
    ]);
    await crearCobro(ajena, suyo.clientId, { monto: 9_000_000, hace: 5 });
    await crearPromesa(ajena, suyo.clientId, {
      monto: 20_000_000,
      venceEn: -5,
      cargadaHace: 10,
    });
    await prisma.managementAction.create({
      data: {
        organizationId: ajena.organizationId,
        clientId: suyo.clientId,
        operatorId: ajena.operadorId,
        actionType: "WHATSAPP",
        result: "NO_ANSWER",
      },
    });
  }

  await prisma.segment.create({
    data: {
      organizationId: ajena.organizationId,
      name: "Segmento ajeno",
      filters: { tramo: "LEGAL" },
    },
  });
}, 180_000);

afterAll(async () => {
  await borrarOrganizacion(propia.organizationId);
  await borrarOrganizacion(ajena.organizationId);
});

describe("ninguna consulta cruza datos de otra organización", () => {
  it("la lista de deudores", async () => {
    const r = await getClients(propia.organizationId, propia.adminId, "ADMIN", {}, 1);
    expect(r.total).toBe(1);
    expect(r.rows[0]?.name).toBe("Deudor propio");
  });

  it("el filtro por producto no alcanza productos ajenos", async () => {
    const conAjeno = await getClients(
      propia.organizationId,
      propia.adminId,
      "ADMIN",
      { product: "Crédito ajeno" },
      1,
    );
    expect(conAjeno.total).toBe(0);

    expect(await getProductOptions(propia.organizationId)).toEqual(["Crédito propio"]);
  });

  it("los KPIs del dashboard", async () => {
    const kpis = await getKpis(propia.organizationId);
    expect(kpis.openDebt).toBe(1_000_000);
    // 50.000.000 × 4 de la otra organización no pueden aparecer por ningún lado.
    expect(kpis.openDebt).toBeLessThan(50_000_000);
  });

  it("el gráfico de tramos", async () => {
    const total = (await getTranches(propia.organizationId)).reduce(
      (sum, t) => sum + t.amount,
      0,
    );
    expect(total).toBe(1_000_000);
  });

  it("la tabla de operadores", async () => {
    const filas = await getOperatorStats(propia.organizationId);
    expect(filas.map((f) => f.fullName).sort()).toEqual([
      "Admin de prueba",
      "Operador de prueba",
    ]);
  });

  it("el recupero del período", async () => {
    const r = await getRecovery(propia.organizationId, PERIODO);
    expect(r.collected).toBe(100_000);
    expect(r.paymentsCount).toBe(1);
  });

  it("la contactabilidad por canal", async () => {
    const canales = await getContactability(propia.organizationId, PERIODO);
    const whatsapp = canales.find((c) => c.channel === "WHATSAPP")!;
    // Las cuatro gestiones de WhatsApp son de la otra organización.
    expect(whatsapp.attempts).toBe(0);

    const llamadas = canales.find((c) => c.channel === "CALL")!;
    expect(llamadas.promises).toBe(1);
  });

  it("el cumplimiento de promesas", async () => {
    const r = await getPromises(propia.organizationId, PERIODO);
    expect(r.totalPromised).toBe(500_000);
  });

  it("los segmentos guardados", async () => {
    expect(await getSegments(propia.organizationId)).toHaveLength(0);
    expect(await getSegments(ajena.organizationId)).toHaveLength(1);
  });
});

describe("el operador solo ve su propia cartera", () => {
  it("un operador sin deudores asignados no ve los del resto", async () => {
    // Los deudores del fixture quedan asignados al operador de su organización.
    const suyos = await getClients(
      propia.organizationId,
      propia.operadorId,
      "OPERATOR",
      {},
      1,
    );
    expect(suyos.total).toBe(1);

    // El admin de la otra organización no puede verlos ni siendo admin.
    const ajenos = await getClients(
      propia.organizationId,
      ajena.operadorId,
      "OPERATOR",
      {},
      1,
    );
    expect(ajenos.total).toBe(0);
  });
});
