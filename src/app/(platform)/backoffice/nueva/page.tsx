import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { getPlatformSession } from "@/lib/platform/access";

import { AltaForm } from "./alta-form";

export const metadata: Metadata = {
  title: "Backoffice · Alta de empresa",
};

export default async function NuevaEmpresaPage() {
  const session = await getPlatformSession();
  if (!session) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <Link
        href="/backoffice"
        className="inline-flex items-center gap-2 text-sm text-pand-gris hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver
      </Link>

      <div>
        <h1 className="text-xl font-bold text-white">Dar de alta una empresa</h1>
        <p className="mt-1 text-sm text-pand-gris">
          Crea la organización e invita a su primer administrador, que después
          suma al resto de su equipo desde Configuración.
        </p>
      </div>

      <AltaForm />
    </div>
  );
}
