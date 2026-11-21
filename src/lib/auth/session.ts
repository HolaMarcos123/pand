import { redirect } from "next/navigation";
import { cache } from "react";

import type { ConfigInteres } from "@/lib/collections/intereses";
import {
  resolverSettings,
  type CampoPropio,
  type Tipificaciones,
} from "@/lib/config/settings";
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
    /** Fecha desde la que la cuenta está suspendida por la administración. */
    suspendedAt: Date | null;
    /** Atajo a settings.currency, que es el que usa casi toda la UI. */
    currency: string;
    /**
     * Las tipificaciones resueltas: las necesitan la bandeja, la ficha del deudor
     * y los reportes, y la sesión ya trae la fila de la organización.
     *
     * Va este campo y NO la configuración entera, a propósito. El layout le pasa
     * la sesión completa al AuthProvider, que es un componente cliente: todo lo
     * que se agregue acá termina serializado en el HTML de todas las pantallas,
     * para todos los roles. Las etiquetas no tienen problema en estar ahí. Las
     * tasas de interés, los objetivos de cobro y sobre todo las credenciales de
     * integraciones que va a guardar Configuración, sí.
     *
     * Lo que necesite el resto de la configuración, que la lea del servidor.
     */
    tipificaciones: Tipificaciones;
    /**
     * Las columnas propias de la organizacion. Van aca por la misma razon que
     * las tipificaciones: las necesita el importador, que es una pantalla
     * cliente. Son etiquetas, no secretos.
     */
    camposPropios: CampoPropio[];
    /** Tasa de interés por mora. Es un parámetro de presentación, no un secreto. */
    cobranza: ConfigInteres;
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
  const supabase = await createClient();

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

  const settings = resolverSettings(dbUser.organization.settings);

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
      suspendedAt: dbUser.organization.suspendedAt,
      currency: settings.currency,
      tipificaciones: settings.tipificaciones,
      camposPropios: settings.camposPropios,
      cobranza: settings.cobranza,
    },
  };
});

/**
 * Igual que getSession pero corta el render y manda al login si no hay sesion.
 *
 * Tambien corta si la organizacion esta suspendida. El chequeo va aca y no en el
 * layout a proposito: por aca pasan tambien las server actions, asi que una
 * cuenta suspendida no puede seguir registrando cobros desde una pestaña que
 * quedo abierta. El layout solo evitaria que se vea la pantalla.
 */
export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.organization.suspendedAt) redirect("/cuenta-suspendida");
  return session;
}

/** Corta el render si el rol no alcanza. Se usa para /admin/*. */
export async function requireRole(...roles: Role[]): Promise<SessionData> {
  const session = await requireSession();
  if (!roles.includes(session.user.role)) redirect("/overview");
  return session;
}
