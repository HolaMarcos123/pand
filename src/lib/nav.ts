import {
  BarChart3,
  Bot,
  LayoutDashboard,
  ListChecks,
  Settings,
  Users,
  UsersRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Role } from "@/generated/prisma/enums";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Muestra el contador de tareas del día al lado del label. */
  showTaskBadge?: boolean;
};

/**
 * Navegación por rol, tal cual el reparto del P03.
 *
 * El operador ve dos ítems y nada más: su pantalla es la bandeja, y cada entrada de
 * menú que no va a usar es ruido en la pantalla que más mira en el día.
 *
 * Esto controla lo que se dibuja, no lo que se puede alcanzar. Las rutas se protegen
 * del lado del servidor con `requireRole`: esconder un link no es autorización.
 */
const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  ADMIN: [
    { href: "/overview", label: "Overview", icon: LayoutDashboard },
    { href: "/portfolio", label: "Cartera", icon: Wallet },
    { href: "/clients", label: "Clientes", icon: UsersRound },
    { href: "/tasks", label: "Tareas", icon: ListChecks, showTaskBadge: true },
    { href: "/admin/users", label: "Usuarios", icon: Users },
    { href: "/reports", label: "Reportes", icon: BarChart3 },
    { href: "/ai-agent", label: "IA", icon: Bot },
    { href: "/admin/settings", label: "Config", icon: Settings },
  ],
  SUPERVISOR: [
    { href: "/overview", label: "Overview", icon: LayoutDashboard },
    { href: "/clients", label: "Clientes", icon: UsersRound },
    { href: "/tasks", label: "Tareas", icon: ListChecks, showTaskBadge: true },
    { href: "/reports", label: "Reportes", icon: BarChart3 },
    { href: "/ai-agent", label: "IA", icon: Bot },
  ],
  OPERATOR: [
    { href: "/tasks", label: "Mis Tareas", icon: ListChecks, showTaskBadge: true },
    { href: "/clients", label: "Clientes", icon: UsersRound },
  ],
};

export function navFor(role: Role): NavItem[] {
  return NAV_BY_ROLE[role];
}

/** Título que muestra el header, resuelto desde la ruta activa. */
export function titleForPath(pathname: string): string {
  const match = Object.values(NAV_BY_ROLE)
    .flat()
    .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return match?.label ?? "Pand";
}
