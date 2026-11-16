import type { Metadata } from "next";

import { BrandPanel } from "@/components/auth/brand-panel";

import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

/**
 * La pantalla que el login venía enlazando desde siempre y que no existía: el
 * link daba 404 en producción.
 */
export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <section className="flex items-center justify-center bg-pand-bg px-6 py-12">
        <div className="w-full max-w-sm">
          <ForgotPasswordForm />
        </div>
      </section>
    </main>
  );
}
