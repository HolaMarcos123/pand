import type { Metadata } from "next";

import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { UploadWizard } from "./upload-wizard";

export const metadata: Metadata = {
  title: "Nueva cartera",
};

export default async function NewPortfolioPage() {
  const session = await requireSession();

  // Chequeo antes de consultar: el layout no alcanza, la página se renderiza igual
  // y su resultado viaja en el payload de RSC.
  if (session.user.role === "OPERATOR") {
    return <Forbidden organizationName={session.organization.name} />;
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { settings: true },
  });

  const settings =
    organization.settings && typeof organization.settings === "object"
      ? (organization.settings as Record<string, unknown>)
      : {};

  const savedMappings =
    settings.columnMappings && typeof settings.columnMappings === "object"
      ? (settings.columnMappings as Record<string, Record<string, string>>)
      : {};

  return (
    <UploadWizard
      defaultSector={session.organization.sector}
      currency={session.organization.currency}
      camposPropios={session.organization.camposPropios}
      // Crear un campo propio escribe en la configuración de la organización, y
      // eso es de administradores. Un supervisor importa igual: ve el aviso de
      // que el campo lo tiene que crear un admin, en vez de un botón que falla.
      puedeCrearCampos={session.user.role === "ADMIN"}
      savedMappings={savedMappings}
    />
  );
}
