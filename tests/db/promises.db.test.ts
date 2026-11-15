import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPromises } from "@/lib/queries/reports";

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
 * Cumplimiento de promesas.
 *
 * Es el reporte más fácil de leer mal: mide plata contra plata, y cualquier error
 * de borde lo deja mintiendo sin romperse. Los dos casos que ya pasaron —el
 * sobrepago inflando el indicador por encima del 100 % y las promesas vigentes
 * metidas en el divisor— están fijados acá para que no vuelvan.
 */

let ctx: Contexto;
// Ventana amplia, para que entren todas las promesas de los fixtures.
const PERIODO = { from: fechaIso(-60), to: fechaIso(60) };

beforeAll(async () => {
  ctx = await crearOrganizacion("promesas");

  // Cumplió: prometió 1.000.000 y pagó 1.000.000 antes del vencimiento.
  const cumple = await crearDeudor(ctx, "Cumple", [{ mora: 30, monto: 5_000_000 }]);
  await crearPromesa(ctx, cumple.clientId, { monto: 1_000_000, venceEn: -10, cargadaHace: 20 });
  await crearCobro(ctx, cumple.clientId, { monto: 1_000_000, hace: 12 });

  // Pagó de más: el exceso NO puede tapar las promesas rotas de los demás.
  const sobrepaga = await crearDeudor(ctx, "Sobrepaga", [{ mora: 30, monto: 9_000_000 }]);
  await crearPromesa(ctx, sobrepaga.clientId, { monto: 1_000_000, venceEn: -10, cargadaHace: 20 });
  await crearCobro(ctx, sobrepaga.clientId, { monto: 5_000_000, hace: 11 });

  // Rota: venció hace rato y no entró nada.
  const rompe = await crearDeudor(ctx, "Rompe", [{ mora: 60, monto: 4_000_000 }]);
  await crearPromesa(ctx, rompe.clientId, { monto: 2_000_000, venceEn: -20, cargadaHace: 30 });

  // Pagó una parte.
  const parcial = await crearDeudor(ctx, "Parcial", [{ mora: 45, monto: 4_000_000 }]);
  await crearPromesa(ctx, parcial.clientId, { monto: 2_000_000, venceEn: -15, cargadaHace: 25 });
  await crearCobro(ctx, parcial.clientId, { monto: 500_000, hace: 16 });

  // Vigente: vence la semana que viene, todavía no se la puede juzgar.
  const vigente = await crearDeudor(ctx, "Vigente", [{ mora: 10, monto: 3_000_000 }]);
  await crearPromesa(ctx, vigente.clientId, { monto: 3_000_000, venceEn: 7, cargadaHace: 2 });

  // Pagó dentro de los días de gracia: llegó tarde, no incumplió.
  const gracia = await crearDeudor(ctx, "Gracia", [{ mora: 30, monto: 2_000_000 }]);
  await crearPromesa(ctx, gracia.clientId, { monto: 800_000, venceEn: -5, cargadaHace: 15 });
  await crearCobro(ctx, gracia.clientId, { monto: 800_000, hace: 3 });

  // Reprometió tres veces para la misma fecha: es UNA promesa, no tres.
  const insiste = await crearDeudor(ctx, "Insiste", [{ mora: 90, monto: 6_000_000 }]);
  for (const hace of [25, 20, 15]) {
    await crearPromesa(ctx, insiste.clientId, {
      monto: 1_500_000,
      venceEn: -8,
      cargadaHace: hace,
    });
  }
}, 180_000);

afterAll(async () => {
  await borrarOrganizacion(ctx.organizationId);
});

function porEstado(reporte: Awaited<ReturnType<typeof getPromises>>, estado: string) {
  return reporte.byState.find((row) => row.state === estado)!;
}

describe("clasificación de promesas", () => {
  it("separa cumplidas, parciales, rotas y vigentes", async () => {
    const r = await getPromises(ctx.organizationId, PERIODO);

    // Cumple, Sobrepaga y Gracia.
    expect(porEstado(r, "CUMPLIDA").count).toBe(3);
    expect(porEstado(r, "PARCIAL").count).toBe(1);
    // Rompe e Insiste.
    expect(porEstado(r, "ROTA").count).toBe(2);
    expect(porEstado(r, "VIGENTE").count).toBe(1);
  });

  it("un pago dentro de los días de gracia cuenta como cumplido", async () => {
    // Una promesa del viernes pagada el lunes llegó tarde, no se incumplió.
    const r = await getPromises(ctx.organizationId, PERIODO);
    const cumplidas = porEstado(r, "CUMPLIDA");
    expect(cumplidas.promised).toBe(1_000_000 + 1_000_000 + 800_000);
  });

  it("reprometer para la misma fecha no multiplica el monto prometido", async () => {
    // Sin el DISTINCT ON, las tres llamadas a "Insiste" sumarían 4.500.000 y el
    // prometido del mes saldría multiplicado por la insistencia del operador.
    const r = await getPromises(ctx.organizationId, PERIODO);
    expect(porEstado(r, "ROTA").promised).toBe(2_000_000 + 1_500_000);
  });
});

describe("el indicador de cumplimiento", () => {
  it("nunca pasa del 100 %, por más que alguien pague de más", async () => {
    // Bug real: un deudor que pagó cinco veces lo prometido dejaba el indicador
    // en 208 % y tapaba las promesas rotas de todos los demás.
    const r = await getPromises(ctx.organizationId, PERIODO);
    expect(r.complianceRate).toBeLessThanOrEqual(100);
  });

  it("cada promesa aporta como mucho su propio monto", async () => {
    const r = await getPromises(ctx.organizationId, PERIODO);
    for (const fila of r.byState) {
      expect(fila.honored).toBeLessThanOrEqual(fila.promised);
    }
  });

  it("las vigentes no entran en el divisor", async () => {
    const r = await getPromises(ctx.organizationId, PERIODO);

    // Vencidas: 1.000.000 + 1.000.000 + 800.000 cumplidas, 2.000.000 parcial
    // (entró 500.000), 2.000.000 + 1.500.000 rotas.
    const prometidoVencido = 1_000_000 + 1_000_000 + 800_000 + 2_000_000 + 2_000_000 + 1_500_000;
    const cobradoVencido = 1_000_000 + 1_000_000 + 800_000 + 500_000;

    expect(r.complianceRate).toBeCloseTo((cobradoVencido / prometidoVencido) * 100, 4);

    // Si las vigentes contaran, el indicador arrancaría el mes en cero y subiría
    // solo por el paso del tiempo, sin que nadie cobre nada.
    const conVigentes = (cobradoVencido / (prometidoVencido + 3_000_000)) * 100;
    expect(r.complianceRate).not.toBeCloseTo(conVigentes, 4);
  });
});

describe("el top de incumplidas", () => {
  it("lista rotas y parciales, ordenadas por lo que falta entrar", async () => {
    const r = await getPromises(ctx.organizationId, PERIODO);

    // Rompe debe 2.000.000. Parcial e Insiste empatan en 1.500.000 sin cobrar, y
    // el desempate es por la promesa más vieja: primero la que lleva más tiempo
    // sin cumplirse.
    expect(r.broken.map((b) => b.clientName)).toEqual(["Rompe", "Parcial", "Insiste"]);

    const faltantes = r.broken.map((b) => b.promised - b.paid);
    expect(faltantes).toEqual([...faltantes].sort((a, b) => b - a));
  });

  it("no incluye las cumplidas ni las vigentes", async () => {
    const r = await getPromises(ctx.organizationId, PERIODO);
    const nombres = r.broken.map((b) => b.clientName);
    for (const quien of ["Cumple", "Sobrepaga", "Gracia", "Vigente"]) {
      expect(nombres).not.toContain(quien);
    }
  });
});

describe("el período se respeta", () => {
  it("una ventana que no contiene ninguna promesa devuelve todo en cero", async () => {
    const r = await getPromises(ctx.organizationId, {
      from: fechaIso(300),
      to: fechaIso(330),
    });

    expect(r.totalPromised).toBe(0);
    expect(r.broken).toHaveLength(0);
    expect(r.complianceRate).toBe(0);
  });
});
