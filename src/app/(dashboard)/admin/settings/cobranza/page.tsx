import type { Metadata } from "next";

import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";
import { resolverSettings } from "@/lib/config/settings";
import { prisma } from "@/lib/prisma";

import { CobranzaForm } from "./cobranza-form";

export const metadata: Metadata = {
  title: "Configuración · Cobranza",
};

export default async function CobranzaPage() {
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

  const { cobranza, currency } = resolverSettings(organizacion.settings);

  return <CobranzaForm tasaMensual={cobranza.tasaMensual} currency={currency} />;
}
