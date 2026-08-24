import { redirect } from "next/navigation";
import { cache } from "react";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import type { Plan, Role, Sector } from "@/generated/prisma/enums";

export type SessionData = {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    avatarUrl: string | null;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    sector: Sector;
    plan: Plan;
    trialEnds: Date | null;
    isOnboarded: boolean;
  };
};

/**
 * Sesion completa: el usuario de Supabase Auth cruzado con su fila en `users` y la
 * organizacion a la que pertenece.
 *
 * Va envuelto en `cache` de React para que el layout, la pagina y cualquier Server
 * Component que la pida dentro del mismo request compartan una sola consulta.
 */
export const getSession = cache(async (): Promise<SessionData | null> => {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { organization: true },
  });

  // Sin fila en `users` la cuenta quedo a medio crear; desactivada, se la trata como
  // si no hubiera sesion.
  if (!dbUser || !dbUser.isActive) return null;

  return {
    user: {
      id: dbUser.id,
      email: dbUser.email,
      fullName: dbUser.fullName,
      role: dbUser.role,
      avatarUrl: dbUser.avatarUrl,
    },
    organization: {
      id: dbUser.organization.id,
      name: dbUser.organization.name,
      slug: dbUser.organization.slug,
      sector: dbUser.organization.sector,
      plan: dbUser.organization.plan,
      trialEnds: dbUser.organization.trialEnds,
      isOnboarded: dbUser.organization.isOnboarded,
    },
  };
});

/** Igual que getSession pero corta el render y manda al login si no hay sesion. */
export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Corta el render si el rol no alcanza. Se usa para /admin/*. */
export async function requireRole(...roles: Role[]): Promise<SessionData> {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) redirect("/overview");
  return session;
}
