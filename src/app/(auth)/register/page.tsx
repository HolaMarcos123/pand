import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";

import { BrandPanel } from "@/components/auth/brand-panel";
import { isRegistrationOpen } from "@/lib/auth/registration";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

/**
 * Se resuelve en cada request y no en el build: asi abrir o cerrar el registro es
 * cambiar una variable y redesplegar, sin tener que reconstruir.
 */
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const open = isRegistrationOpen();

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <section className="flex items-center justify-center bg-pand-bg px-6 py-12">
        <div className="w-full max-w-sm">
          {open ? (
            <>
              <h1 className="text-3xl font-extrabold tracking-tight">
                Creá tu cuenta
              </h1>
              <p className="mt-2 text-sm text-pand-gris">
                Empezá a cobrar mejor en menos de cinco minutos.
              </p>

              <RegisterForm />
            </>
          ) : (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pand-celeste">
                <Lock className="h-5 w-5 text-pand-contorno" />
              </span>

              <h1 className="mt-5 text-3xl font-extrabold tracking-tight">
                El registro está cerrado
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-pand-gris">
                Pand todavía no está abierto al público. Si tu equipo ya tiene una
                cuenta, pedile a quien la administre que te envíe una invitación.
              </p>

              <div className="mt-8 rounded-xl border border-pand-border bg-white p-4">
                <p className="text-sm text-pand-gris">
                  ¿Te interesa usarlo en tu empresa? Escribinos y te avisamos cuando
                  abramos.
                </p>
              </div>
            </>
          )}

          <p className="mt-8 text-center text-sm text-pand-gris">
            {open ? "¿Ya tenés cuenta? " : "¿Ya tenés una cuenta? "}
            <Link
              href="/login"
              className="font-semibold text-pand-azul hover:underline"
            >
              Ingresá
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
