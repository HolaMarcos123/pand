import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/auth/brand-panel";
import { isRegistrationOpen } from "@/lib/auth/registration";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Ingresar",
};

// Igual que /register: se resuelve por request para que abrir o cerrar el alta no
// obligue a reconstruir.
export const dynamic = "force-dynamic";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirectTo?: string };
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <section className="flex items-center justify-center bg-pand-bg px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl font-extrabold tracking-tight">
            Ingresá a tu cuenta
          </h1>
          <p className="mt-2 text-sm text-pand-gris">
            Seguí la cartera de tu equipo desde un solo lugar.
          </p>

          <LoginForm redirectTo={searchParams.redirectTo} />

          {/* Sin registro abierto no se ofrece un camino que termina en una puerta
              cerrada: quien no tiene cuenta necesita una invitación, no un link. */}
          {isRegistrationOpen() && (
            <p className="mt-8 text-center text-sm text-pand-gris">
              ¿No tenés cuenta?{" "}
              <Link
                href="/register"
                className="font-semibold text-pand-azul hover:underline"
              >
                Registrate
              </Link>
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
