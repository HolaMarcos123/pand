"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronsLeft,
  ChevronsRight,
  Globe,
  LogOut,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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

/**
 * Dónde se recuerda si la barra quedó contraída.
 *
 * En el navegador y no en el servidor a propósito: es una preferencia de esta
 * pantalla, no un dato de la cuenta. Quien trabaja en un monitor ancho y en una
 * notebook la quiere distinta en cada una.
 */
const CLAVE_CONTRAIDA = "pand:sidebar-contraida";

/**
 * El estado contraido, leido del navegador.
 *
 * Va por `useSyncExternalStore` y no por un efecto que llama a setState: en el
 * servidor no hay localStorage, asi que la primera pintura tiene que ser la
 * expandida y recien despues ajustarse. Es para lo que existe el tercer
 * argumento, y de paso dos pestanas abiertas quedan sincronizadas.
 */
let contraidaEnMemoria: boolean | null = null;
const oyentes = new Set<() => void>();

function leerContraida(): boolean {
  if (contraidaEnMemoria === null) {
    try {
      contraidaEnMemoria = window.localStorage.getItem(CLAVE_CONTRAIDA) === "1";
    } catch {
      // Ventana privada o almacenamiento bloqueado: abre expandida.
      contraidaEnMemoria = false;
    }
  }
  return contraidaEnMemoria;
}

function guardarContraida(valor: boolean) {
  contraidaEnMemoria = valor;
  try {
    window.localStorage.setItem(CLAVE_CONTRAIDA, valor ? "1" : "0");
  } catch {
    // Que no se pueda recordar no es razon para no contraerla ahora.
  }
  for (const avisar of oyentes) avisar();
}

function suscribir(avisar: () => void) {
  oyentes.add(avisar);
  window.addEventListener("storage", avisar);
  return () => {
    oyentes.delete(avisar);
    window.removeEventListener("storage", avisar);
  };
}

/** En el servidor no hay preferencia que leer: siempre expandida. */
const enElServidor = () => false;

export function Sidebar({
  taskCount,
  esAdminDePlataforma,
}: {
  taskCount: number;
  /**
   * Si quien mira administra Pand, no esta empresa.
   *
   * Llega calculado desde el servidor: la lista de administradores vive en una
   * variable de entorno que no es NEXT_PUBLIC, y tiene que seguir siendo así.
   * Acá solo entra el booleano.
   */
  esAdminDePlataforma: boolean;
}) {
  const pathname = usePathname();
  const { user, organization, role, plan, isLoading, signOut } = useAuth();

  const contraida = useSyncExternalStore(suscribir, leerContraida, enElServidor);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function alternar() {
    guardarContraida(!contraida);
    setMenuAbierto(false);
  }

  // Clic afuera y Escape cierran el menú. Sin esto queda abierto tapando el
  // último ítem del menú, que es donde se cierra sesión.
  useEffect(() => {
    if (!menuAbierto) return;

    const alClic = (evento: MouseEvent) => {
      if (!menuRef.current?.contains(evento.target as Node)) setMenuAbierto(false);
    };
    const alTeclado = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenuAbierto(false);
    };

    document.addEventListener("mousedown", alClic);
    document.addEventListener("keydown", alTeclado);
    return () => {
      document.removeEventListener("mousedown", alClic);
      document.removeEventListener("keydown", alTeclado);
    };
  }, [menuAbierto]);

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col bg-pand-contorno transition-[width] duration-200",
        contraida ? "w-[72px]" : "w-[260px]",
      )}
    >
      <div
        className={cn(
          "flex items-center py-6",
          contraida ? "justify-center px-3" : "justify-between px-6",
        )}
      >
        {/* Isologo sin cuadrado + wordmark, como manda el manual para el producto.
            El SVG del kit viene en #2A2A35: se invierte para que se vea acá.
            Contraída queda solo el isologo, que es lo que entra. */}
        <Image
          src={contraida ? "/brand/isologo.svg" : "/brand/logo.svg"}
          alt="Pand"
          width={contraida ? 420 : 1400}
          height={420}
          priority
          className={cn("w-auto brightness-0 invert", contraida ? "h-7" : "h-7")}
        />

        {!contraida && (
          <button
            type="button"
            onClick={alternar}
            aria-label="Contraer la barra"
            title="Contraer la barra"
            className="rounded-md p-1.5 text-pand-gris transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {contraida && (
        <div className="flex justify-center pb-2">
          <button
            type="button"
            onClick={alternar}
            aria-label="Expandir la barra"
            title="Expandir la barra"
            className="rounded-md p-1.5 text-pand-gris transition-colors hover:bg-white/5 hover:text-white"
          >
            <ChevronsRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <nav className={cn("flex-1 space-y-1", contraida ? "px-2" : "px-3")}>
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
                className={cn(
                  "flex cursor-not-allowed items-center gap-3 rounded-lg py-2 text-sm font-semibold text-pand-gris/50",
                  contraida ? "justify-center px-2" : "px-3",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!contraida && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    <span className="rounded-badge bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pand-gris">
                      Pronto
                    </span>
                  </>
                )}
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              // Contraída el texto no está, así que el nombre tiene que llegar
              // por otro lado: si no, el menú son siete dibujos sin nombre.
              title={contraida ? item.label : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg py-2 text-sm font-semibold transition-colors",
                contraida ? "justify-center px-2" : "px-3",
                active
                  ? "bg-pand-celeste/20 text-pand-celeste"
                  : "text-pand-gris hover:text-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />

              {!contraida && <span className="flex-1">{item.label}</span>}

              {item.showTaskBadge && taskCount > 0 && (
                <span
                  className={cn(
                    "mono bg-pand-coral text-white",
                    contraida
                      ? "absolute right-1 top-1 h-2 w-2 rounded-full"
                      : "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  )}
                >
                  {!contraida && taskCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* El backoffice no es parte del producto que usa el cliente: va separado
          del menú, abajo de todo y con otro tratamiento, para que nadie lo
          confunda con una pantalla más de su empresa. */}
      {esAdminDePlataforma && (
        <div className={cn("pb-2", contraida ? "px-2" : "px-3")}>
          <Link
            href="/backoffice"
            title={contraida ? "Backoffice" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-pand-coral/40 py-2 text-sm font-semibold text-pand-coral transition-colors hover:bg-pand-coral/10",
              contraida ? "justify-center px-2" : "px-3",
            )}
          >
            <ShieldCheck className="h-4 w-4 shrink-0" />
            {!contraida && <span className="flex-1">Backoffice</span>}
          </Link>
        </div>
      )}

      <div
        ref={menuRef}
        className={cn(
          "relative space-y-4 border-t border-white/10",
          contraida ? "p-2" : "p-4",
        )}
      >
        {!contraida && (
          <div className="flex items-center justify-between">
            <span className="truncate text-xs font-semibold uppercase tracking-wider text-pand-gris">
              {organization.name}
            </span>
            <span className="mono shrink-0 rounded-badge bg-white/10 px-2 py-0.5 text-[11px] font-medium text-pand-celeste">
              {planBadgeLabel(plan, organization.trialEnds)}
            </span>
          </div>
        )}

        {/* Una sola puerta para todo lo que es "de mi cuenta": el plan, la
            configuración y el cierre de sesión. Antes el único botón acá era
            salir, pegado al nombre: el gesto más destructivo del menú era
            también el más fácil de apretar sin querer. */}
        <button
          type="button"
          onClick={() => setMenuAbierto((abierto) => !abierto)}
          aria-haspopup="menu"
          aria-expanded={menuAbierto}
          title={contraida ? user.fullName : undefined}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg p-1 text-left transition-colors hover:bg-white/5",
            contraida && "justify-center",
          )}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pand-celeste text-xs font-bold text-pand-contorno">
            {initials(user.fullName)}
          </span>

          {!contraida && (
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-white">
                {user.fullName}
              </span>
              <span className="block truncate text-xs text-pand-gris">
                {user.email}
              </span>
            </span>
          )}
        </button>

        {menuAbierto && (
          <div
            role="menu"
            className={cn(
              "absolute bottom-full z-50 mb-2 w-[260px] overflow-hidden rounded-card border border-pand-border bg-white py-1 shadow-panel",
              contraida ? "left-2" : "left-4",
            )}
          >
            <p className="truncate px-3 py-2 text-xs text-pand-gris">
              {user.email}
            </p>
            <div className="h-px bg-pand-border" />

            <Link
              href="/admin/settings"
              role="menuitem"
              onClick={() => setMenuAbierto(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-pand-contorno transition-colors hover:bg-pand-bg"
            >
              <Settings className="h-4 w-4 text-pand-gris" />
              Configuración
            </Link>

            <Link
              href="/admin/settings/organizacion"
              role="menuitem"
              onClick={() => setMenuAbierto(false)}
              className="flex items-center justify-between gap-2.5 px-3 py-2 text-sm text-pand-contorno transition-colors hover:bg-pand-bg"
            >
              <span className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 text-pand-gris" />
                Plan
              </span>
              <span className="mono rounded-badge bg-pand-bg px-1.5 py-0.5 text-[10px] font-semibold text-pand-gris">
                {planBadgeLabel(plan, organization.trialEnds)}
              </span>
            </Link>

            {/* Apagado y no escondido, igual que el resto de lo que todavía no
                existe: Pand está solo en español y ofrecer un selector que no
                cambia nada es peor que decir que viene. */}
            <span
              aria-disabled="true"
              className="flex cursor-not-allowed items-center justify-between gap-2.5 px-3 py-2 text-sm text-pand-gris opacity-60"
            >
              <span className="flex items-center gap-2.5">
                <Globe className="h-4 w-4" />
                Idioma
              </span>
              <span className="rounded-badge bg-pand-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pand-gris">
                Pronto
              </span>
            </span>

            <div className="h-px bg-pand-border" />

            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              disabled={isLoading}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-pand-contorno transition-colors hover:bg-pand-bg disabled:opacity-50"
            >
              <LogOut className="h-4 w-4 text-pand-gris" />
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
