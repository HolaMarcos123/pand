import type { Metadata } from "next";

import { BrandPanel } from "@/components/auth/brand-panel";

import { DefinirPasswordForm } from "./definir-password-form";

export const metadata: Metadata = {
  title: "Definir contraseña",
};

// Se resuelve por request: la sesión llega en el fragmento de la URL, que el
// servidor nunca ve.
export const dynamic = "force-dynamic";

/**
 * Donde aterriza quien fue invitado o pidió recuperar su contraseña.
 *
 * Antes no existía: la invitación mandaba a /login, así que la persona entraba
 * una vez con el enlace y quedaba sin contraseña, sin manera de volver. El
 * enlace es de un solo uso, así que al día siguiente estaba afuera.
 */
export default function DefinirPasswordPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <BrandPanel />

      <section className="flex items-center justify-center bg-pand-bg px-6 py-12">
        <div className="w-full max-w-sm">
          <DefinirPasswordForm />
        </div>
      </section>
    </main>
  );
}
