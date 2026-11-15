import type { Metadata } from "next";

import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";
import { resolverSettings } from "@/lib/config/settings";
import { prisma } from "@/lib/prisma";

import { OrganizacionForm } from "./organizacion-form";

export const metadata: Metadata = {
  title: "Configuración · Organización",
};

export default async function OrganizacionPage() {
  const session = await requireSession();

  // El chequeo va acá y antes de consultar, no solo en el layout. Ver el
  // comentario de admin/layout: se renderizan en paralelo.
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
    select: { name: true, slug: true, sector: true, plan: true, settings: true },
  });

  const settings = resolverSettings(organizacion.settings);

  return (
    <OrganizacionForm
      name={organizacion.name}
      slug={organizacion.slug}
      sector={organizacion.sector}
      plan={organizacion.plan}
      currency={settings.currency}
      timezone={settings.timezone}
    />
  );
}
