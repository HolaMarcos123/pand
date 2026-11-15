"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";

import { useAuth } from "@/lib/auth/auth-provider";
import { navFor } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** TRIAL mientras dure la prueba; después, el nombre del plan. */
function planBadgeLabel(plan: string, trialEnds: Date | null): string {
  if (trialEnds && new Date(trialEnds) > new Date()) return "TRIAL";
  return plan === "PROFESSIONAL" ? "PRO" : plan;
}

function initials(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function Sidebar({ taskCount }: { taskCount: number }) {
  const pathname = usePathname();
  const { user, organization, role, plan, isLoading, signOut } = useAuth();

  return (
    <aside className="flex w-[260px] shrink-0 flex-col bg-pand-contorno">
      <div className="px-6 py-6">
        {/* Isologo sin cuadrado + wordmark, como manda el manual para el producto.
            El SVG del kit viene en #2A2A35: se invierte para que se vea acá. */}
        <Image
          src="/brand/logo.svg"
          alt="Pand"
          width={1400}
          height={420}
          priority
          className="h-7 w-auto brightness-0 invert"
        />
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navFor(role).map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          // Pantalla todavía no construida: se muestra apagada y sin navegar. Un
          // link a una ruta inexistente manda al usuario a un 404 y parece que el
          // producto está roto; apagado, se lee como "esto viene después".
          if (item.comingSoon) {
            return (
              <span
                key={item.href}
                aria-disabled="true"
                title={`${item.label} todavía no está disponible`}
                className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-pand-gris/50"
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <span className="rounded-badge bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pand-gris">
                  Pronto
                </span>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                active
                  ? "bg-pand-celeste/20 text-pand-celeste"
                  : "text-pand-gris hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>

              {item.showTaskBadge && taskCount > 0 && (
                <span className="mono rounded-full bg-pand-coral px-2 py-0.5 text-[11px] font-medium text-white">
                  {taskCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-4 border-t border-white/10 p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
            {organization.name}
          </span>
          <span className="mono rounded-badge bg-white/10 px-2 py-0.5 text-[11px] font-medium text-pand-celeste">
            {planBadgeLabel(plan, organization.trialEnds)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pand-celeste text-xs font-bold text-pand-contorno">
            {initials(user.fullName)}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {user.fullName}
            </p>
            <p className="truncate text-xs text-pand-gris">{user.email}</p>
          </div>

          <button
            type="button"
            onClick={signOut}
            disabled={isLoading}
            aria-label="Cerrar sesión"
            className="rounded-md p-2 text-pand-gris transition-colors hover:text-white disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
