import { randomUUID } from "node:crypto";

import type { InvoiceStatus, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Andamiaje de los tests contra la base.
 *
 * Cada test se arma su **propia organización** con un slug único y la borra al
 * terminar. Eso es lo que hace que se puedan correr contra la base de desarrollo
 * cuantas veces haga falta: no tocan la demo, no tocan ninguna cartera de verdad,
 * y dos corridas simultáneas no se pisan.
 *
 * El borrado va en cascada desde `organizations`, así que alcanza con borrar esa
 * fila para que no quede nada.
 */

export type Contexto = {
  organizationId: string;
  adminId: string;
  operadorId: string;
  portfolioId: string;
};

export async function crearOrganizacion(etiqueta: string): Promise<Contexto> {
  const organizationId = randomUUID();
  const adminId = randomUUID();
  const operadorId = randomUUID();
  const portfolioId = randomUUID();
  const sufijo = organizationId.slice(0, 8);

  await prisma.organization.create({
    data: {
      id: organizationId,
      name: `TEST ${etiqueta} ${sufijo}`,
      slug: `test-${etiqueta}-${sufijo}`,
      sector: "FINANCIAL",
    },
  });

  // Sin usuario de Supabase Auth: public.users no tiene FK contra auth.users, y
  // estos tests prueban consultas, no el login.
  await prisma.user.createMany({
    data: [
      {
        id: adminId,
        organizationId,
        email: `admin-${sufijo}@test.local`,
        fullName: "Admin de prueba",
        role: "ADMIN" satisfies Role,
      },
      {
        id: operadorId,
        organizationId,
        email: `op-${sufijo}@test.local`,
        fullName: "Operador de prueba",
        role: "OPERATOR" satisfies Role,
      },
    ],
  });

  await prisma.portfolio.create({
    data: { id: portfolioId, organizationId, name: `Cartera ${sufijo}` },
  });

  return { organizationId, adminId, operadorId, portfolioId };
}

export async function borrarOrganizacion(organizationId: string): Promise<void> {
  await prisma.organization.deleteMany({ where: { id: organizationId } });
}

/** Una fecha a `n` días de hoy, a medianoche UTC. */
export function dias(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export function fechaIso(n: number): string {
  return dias(n).toISOString().slice(0, 10);
}

export type DeudaSpec = {
  /** Días de mora. Fija el vencimiento y la columna denormalizada, coherentes. */
  mora: number;
  monto: number;
  pagado?: number;
  estado?: InvoiceStatus;
  producto?: string | null;
};

/**
 * Crea un deudor con sus comprobantes.
 *
 * `days_overdue` se escribe a mano para que el test no dependa del cron nocturno
 * que la recalcula en producción. Se mantiene coherente con `due_date` para que
 * un test que mire una u otra cosa vea lo mismo.
 */
export async function crearDeudor(
  ctx: Contexto,
  nombre: string,
  deudas: DeudaSpec[],
  opciones: { asignadoA?: string | null } = {},
): Promise<{ clientId: string; invoiceIds: string[] }> {
  const clientId = randomUUID();

  await prisma.client.create({
    data: {
      id: clientId,
      organizationId: ctx.organizationId,
      portfolioId: ctx.portfolioId,
      externalId: `${nombre}-${clientId.slice(0, 8)}`,
      name: nombre,
      assignedToId:
        opciones.asignadoA === undefined ? ctx.operadorId : opciones.asignadoA,
    },
  });

  const invoiceIds: string[] = [];

  for (const [indice, deuda] of deudas.entries()) {
    const id = randomUUID();
    invoiceIds.push(id);

    await prisma.invoice.create({
      data: {
        id,
        organizationId: ctx.organizationId,
        clientId,
        invoiceNumber: `${clientId.slice(0, 8)}-${indice + 1}`,
        product: deuda.producto ?? null,
        amount: deuda.monto,
        paidAmount: deuda.pagado ?? 0,
        dueDate: dias(-deuda.mora),
        daysOverdue: Math.max(0, deuda.mora),
        status: deuda.estado ?? (deuda.pagado ? "PARTIAL" : "PENDING"),
      },
    });
  }

  await recalcularSaldo(ctx.organizationId, clientId);

  return { clientId, invoiceIds };
}

/** El mismo criterio de saldo que usa la aplicación, para que el fixture no mienta. */
export async function recalcularSaldo(
  organizationId: string,
  clientId: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE clients c
       SET total_debt = COALESCE((
             SELECT SUM(i.amount - i.paid_amount) FROM invoices i
              WHERE i.client_id = c.id AND i.status IN ('PENDING','PARTIAL')
           ), 0)
     WHERE c.id = ${clientId}::uuid
       AND c.organization_id = ${organizationId}::uuid
  `;
}

export async function crearPromesa(
  ctx: Contexto,
  clientId: string,
  params: { monto: number; venceEn: number; cargadaHace: number },
): Promise<string> {
  const id = randomUUID();

  await prisma.managementAction.create({
    data: {
      id,
      organizationId: ctx.organizationId,
      clientId,
      operatorId: ctx.operadorId,
      actionType: "CALL",
      result: "PROMISE_PAY",
      promiseAmount: params.monto,
      promiseDate: dias(params.venceEn),
      createdAt: dias(-params.cargadaHace),
    },
  });

  return id;
}

export async function crearCobro(
  ctx: Contexto,
  clientId: string,
  params: { monto: number; hace: number; metodo?: "CASH" | "BANCARD" | "DEPOSIT" },
): Promise<void> {
  await prisma.payment.create({
    data: {
      id: randomUUID(),
      organizationId: ctx.organizationId,
      clientId,
      amount: params.monto,
      paymentDate: dias(-params.hace),
      paymentMethod: params.metodo ?? "CASH",
      reference: randomUUID(),
    },
  });
}
