import type { Metadata } from "next";
import Link from "next/link";
import { PauseCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Cuenta suspendida",
};

/**
 * Adonde llega alguien cuya empresa fue suspendida desde la administración.
 *
 * Es pública a propósito: la persona tiene una sesión perfectamente válida, lo
 * que no tiene es una cuenta activa. Si esta pantalla exigiera sesión, el
 * redirect de `requireSession` la traería de vuelta acá y el browser entraría en
 * un bucle.
 *
 * No dice por qué está suspendida. El motivo —falta de pago, un conflicto
 * comercial— es una conversación entre personas, y adivinarlo en una pantalla
 * solo puede salir mal.
 */
export default function CuentaSuspendidaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-pand-bg px-6">
      <div className="w-full max-w-md rounded-card bg-white p-8 text-center shadow-card">
        <PauseCircle className="mx-auto h-10 w-10 text-pand-coral" />

        <h1 className="mt-4 text-xl font-bold">Tu cuenta está suspendida</h1>

        <p className="mt-3 text-sm text-pand-gris">
          El acceso a Pand para tu empresa está pausado por el momento. Tus datos
          están intactos: la cartera, las gestiones y el historial siguen donde
          estaban y vuelven apenas se reactive la cuenta.
        </p>

        <p className="mt-4 text-sm text-pand-gris">
          Escribinos a{" "}
          <a
            href="mailto:soporte@pand.app"
            className="font-semibold text-pand-azul hover:underline"
          >
            soporte@pand.app
          </a>{" "}
          y lo resolvemos.
        </p>

        <Link
          href="/login"
          className="mono mt-6 inline-block text-xs text-pand-gris hover:underline"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
