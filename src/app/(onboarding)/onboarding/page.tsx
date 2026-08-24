import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

import { OnboardingWizard } from "./onboarding-wizard";

export const metadata: Metadata = {
  title: "Configuración inicial",
};

export default async function OnboardingPage() {
  const session = await requireSession();

  if (session.organization.isOnboarded) {
    redirect("/overview");
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { name: true, settings: true },
  });

  // settings es Json: lo que dejó el registro (country, currency) más lo que sume
  // el wizard. Se lee con defaults porque el schema no garantiza ninguna clave.
  const settings =
    organization.settings && typeof organization.settings === "object"
      ? (organization.settings as Record<string, unknown>)
      : {};

  return (
    <OnboardingWizard
      organizationName={organization.name}
      currency={typeof settings.currency === "string" ? settings.currency : "PYG"}
      timezone={
        typeof settings.timezone === "string" ? settings.timezone : "America/Asuncion"
      }
    />
  );
}
