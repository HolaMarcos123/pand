"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Columns3, ListChecks, Plug, Target, Users } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Secciones de Configuración.
 *
 * Las que todavía no existen se dibujan apagadas en vez de omitirse: muestran
 * hacia dónde va el módulo sin mandar a nadie a un 404. Es la misma decisión que
 * se tomó en el sidebar principal.
 */
const SECCIONES = [
  {
    href: "/admin/settings/organizacion",
    label: "Organización",
    hint: "Nombre, rubro, moneda y zona horaria",
    icon: Building2,
  },
  {
    href: "/admin/settings/tipificaciones",
    label: "Tipificaciones",
    hint: "Tipos de gestión y resultados",
    icon: ListChecks,
  },
  {
    href: "/admin/settings/usuarios",
    label: "Usuarios",
    hint: "Equipo, roles e invitaciones",
    icon: Users,
  },
  {
    href: "/admin/settings/campos",
    label: "Campos propios",
    hint: "Columnas de tu planilla que Pand no modela",
    icon: Columns3,
  },
  {
    href: "/admin/settings/cobranza",
    label: "Cobranza",
    hint: "Interés por mora",
    icon: Target,
  },
  {
    href: "/admin/settings/integraciones",
    label: "Integraciones",
    hint: "API, webhooks y softphone",
    icon: Plug,
    pronto: true,
  },
];

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="w-full shrink-0 lg:w-[260px]">
      <ul className="space-y-1">
        {SECCIONES.map((seccion) => {
          const activa = pathname === seccion.href;
          const Icon = seccion.icon;

          const contenido = (
            <>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{seccion.label}</span>
                  {seccion.pronto && (
                    <span className="rounded-badge bg-pand-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pand-gris">
                      Pronto
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-pand-gris">
                  {seccion.hint}
                </span>
              </span>
            </>
          );

          if (seccion.pronto) {
            return (
              <li key={seccion.href}>
                <span
                  aria-disabled="true"
                  title={`${seccion.label} todavía no está disponible`}
                  className="flex cursor-not-allowed gap-3 rounded-card px-3 py-2.5 text-sm opacity-50"
                >
                  {contenido}
                </span>
              </li>
            );
          }

          return (
            <li key={seccion.href}>
              <Link
                href={seccion.href}
                aria-current={activa ? "page" : undefined}
                className={cn(
                  "flex gap-3 rounded-card px-3 py-2.5 text-sm transition-colors",
                  activa
                    ? "bg-white shadow-panel"
                    : "hover:bg-white/60",
                )}
              >
                {contenido}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
