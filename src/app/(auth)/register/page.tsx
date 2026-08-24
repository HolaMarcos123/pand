import type { Metadata } from "next";
import Link from "next/link";

import { BrandPanel } from "@/components/auth/brand-panel";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function RegisterPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <section className="flex items-center justify-center bg-pand-bg px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-3xl font-extrabold tracking-tight">Creá tu cuenta</h1>
          <p className="mt-2 text-sm text-pand-gris">
            Empezá a cobrar mejor en menos de cinco minutos.
          </p>

          <RegisterForm />

          <p className="mt-8 text-center text-sm text-pand-gris">
            ¿Ya tenés cuenta?{" "}
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
