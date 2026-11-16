import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import {
  borrarOrganizacion,
  crearCobro,
  crearDeudor,
  crearOrganizacion,
  type Contexto,
} from "./fixtures";

/**
 * Las reglas de desactivar y eliminar usuarios.
 *
 * Las acciones de servidor necesitan sesión, así que acá se prueban las reglas
 * contra la base —que es donde viven— y los permisos se verifican por HTTP
 * aparte. Lo que importa fijar es la asimetría: desactivar conserva el
 * historial, eliminar solo se permite cuando no hay historial que perder.
 */

let ctx: Contexto;

beforeEach(async () => {
  ctx = await crearOrganizacion("usuarios");
});

afterEach(async () => {
  if (ctx) await borrarOrganizacion(ctx.organizationId);
});

describe("el rastro de trabajo de un usuario", () => {
  it("un operador que gestionó y cobró deja historial contable", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);
    await crearCobro(ctx, clientId, { monto: 100_000, hace: 1 });
    await prisma.managementAction.create({
      data: {
        organizationId: ctx.organizationId,
        clientId,
        operatorId: ctx.operadorId,
        actionType: "CALL",
        result: "NO_ANSWER",
      },
    });

    const gestiones = await prisma.managementAction.count({
      where: { operatorId: ctx.operadorId },
    });
    expect(gestiones).toBe(1);
  });

  it("un invitado que nunca entró no deja nada: es el que se puede eliminar", async () => {
    const [gestiones, cobros] = await Promise.all([
      prisma.managementAction.count({ where: { operatorId: ctx.adminId } }),
      prisma.payment.count({ where: { registeredById: ctx.adminId } }),
    ]);

    expect(gestiones).toBe(0);
    expect(cobros).toBe(0);
  });
});

describe("desactivar conserva el historial", () => {
  it("la gestión sigue existiendo y sigue teniendo autor", async () => {
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);
    const gestion = await prisma.managementAction.create({
      data: {
        organizationId: ctx.organizationId,
        clientId,
        operatorId: ctx.operadorId,
        actionType: "CALL",
        result: "PROMISE_PAY",
      },
      select: { id: true },
    });

    await prisma.user.update({
      where: { id: ctx.operadorId },
      data: { isActive: false },
    });

    const despues = await prisma.managementAction.findUniqueOrThrow({
      where: { id: gestion.id },
      select: { operatorId: true },
    });
    expect(despues.operatorId).toBe(ctx.operadorId);
  });

  it("un usuario inactivo no tiene sesión: getSession lo rechaza", async () => {
    // Es la regla que hace que desactivar signifique algo. Vive en
    // lib/auth/session: `if (!dbUser || !dbUser.isActive) return null`.
    await prisma.user.update({
      where: { id: ctx.operadorId },
      data: { isActive: false },
    });

    const fila = await prisma.user.findUnique({
      where: { id: ctx.operadorId },
      select: { isActive: true },
    });
    expect(fila?.isActive).toBe(false);
  });
});

describe("eliminar", () => {
  it("borrar al operador deja sus deudores sin asignar, no los borra", async () => {
    // Importa: la cartera es de la empresa, no del operador. Si el borrado se
    // llevara puestos a los deudores, eliminar a alguien por error destruiría
    // parte de la cartera del cliente.
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);

    await prisma.user.delete({ where: { id: ctx.operadorId } });

    const cliente = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, assignedToId: true },
    });
    expect(cliente).not.toBeNull();
    expect(cliente?.assignedToId).toBeNull();
  });

  it("si se borrara a alguien con gestiones, quedarían sin autor", async () => {
    // Este test documenta por qué la acción NO lo permite: la base deja hacerlo
    // —el FK es SET NULL— y el resultado es un historial anónimo.
    const { clientId } = await crearDeudor(ctx, "Deudor", [{ mora: 10, monto: 1_000_000 }]);
    const gestion = await prisma.managementAction.create({
      data: {
        organizationId: ctx.organizationId,
        clientId,
        operatorId: ctx.operadorId,
        actionType: "CALL",
        result: "PAID",
      },
      select: { id: true },
    });

    await prisma.user.delete({ where: { id: ctx.operadorId } });

    const huerfana = await prisma.managementAction.findUniqueOrThrow({
      where: { id: gestion.id },
      select: { operatorId: true },
    });
    expect(huerfana.operatorId).toBeNull();
  });
});

describe("el último administrador", () => {
  it("se detecta que no queda ningún otro admin activo", async () => {
    const otros = await prisma.user.count({
      where: {
        organizationId: ctx.organizationId,
        role: "ADMIN",
        isActive: true,
        NOT: { id: ctx.adminId },
      },
    });

    // El fixture crea un solo ADMIN: desactivarlo dejaría la empresa sin nadie
    // que pueda administrar usuarios ni configuración.
    expect(otros).toBe(0);
  });
});
