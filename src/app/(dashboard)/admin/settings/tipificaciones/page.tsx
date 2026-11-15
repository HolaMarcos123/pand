import type { Metadata } from "next";

import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";
import { resolverSettings } from "@/lib/config/settings";
import { prisma } from "@/lib/prisma";
import { RESULTS_BY_TYPE } from "@/lib/tasks/action-config";

import { TipificacionesForm } from "./tipificaciones-form";

export const metadata: Metadata = {
  title: "Configuración · Tipificaciones",
};

export default async function TipificacionesPage() {
  const session = await requireSession();

  if (session.user.role !== "ADMIN") {
    return (
      <Forbidden
        organizationName={session.organization.name}
        reason="La configuración de la cuenta está reservada al rol Administrador."
      />
    );
  }

  const organizacion = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { settings: true },
  });

  const { tipificaciones } = resolverSettings(organizacion.settings);

  return (
    <TipificacionesForm
      config={tipificaciones}
      // Qué resultados admite cada tipo como máximo. La organización elige un
      // subconjunto; no puede inventar combinaciones que no tienen sentido, como
      // "ocupado" en un email.
      permitidos={RESULTS_BY_TYPE}
    />
  );
}
