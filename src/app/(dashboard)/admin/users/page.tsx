import type { Metadata } from "next";

import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { InviteUserDialog } from "./invite-user-dialog";
import { UsersTable, type UserRow } from "./users-table";

export const metadata: Metadata = {
  title: "Usuarios",
};

export default async function UsersPage() {
  const session = await requireSession();

  // El chequeo va acá y ANTES de cualquier consulta, no solo en el layout.
  // El layout y la página se renderizan en paralelo: si la página consulta y después
  // el layout decide no mostrarla, los datos igual viajan al browser dentro del
  // payload de RSC. Cortar antes del `await` a la base es lo que evita la fuga.
  if (session.user.role !== "ADMIN") {
    return <Forbidden organizationName={session.organization.name} />;
  }

  const [users, organization] = await Promise.all([
    prisma.user.findMany({
      // El filtro por organizationId no es opcional: Prisma corre con BYPASSRLS.
      where: { organizationId: session.organization.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
      },
      orderBy: [{ role: "asc" }, { fullName: "asc" }],
    }),
    prisma.organization.findUniqueOrThrow({
      where: { id: session.organization.id },
      select: { seatsUsed: true, seatsMax: true },
    }),
  ]);

  // Las fechas se serializan antes de cruzar al Client Component.
  const rows: UserRow[] = users.map((user) => ({
    ...user,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Equipo</h2>
          <p className="mt-1 text-sm text-pand-gris">
            <span className="mono">
              {organization.seatsUsed}/{organization.seatsMax}
            </span>{" "}
            usuarios usados en tu plan.
          </p>
        </div>

        <InviteUserDialog
          seatsLeft={Math.max(0, organization.seatsMax - organization.seatsUsed)}
        />
      </div>

      <UsersTable users={rows} />
    </div>
  );
}
