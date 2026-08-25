import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { requireSession } from "@/lib/auth/session";
import {
  isFeatureEnabled,
  minimumPlanFor,
  PLAN_LABELS,
  type FeatureKey,
} from "@/lib/feature-flags";

/**
 * Envuelve una sección que depende del plan. Si no está incluida, muestra el card de
 * upgrade en vez del contenido.
 *
 * Es un Server Component: el plan se resuelve del lado del servidor y el contenido
 * bloqueado nunca llega al browser. Un guard en el cliente solo lo escondería.
 *
 * Aun así, esto es presentación, no autorización: la ruta o la action que ejecuta la
 * feature tiene que volver a validar el plan por su cuenta.
 */
export async function PlanGuard({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: React.ReactNode;
}) {
  const session = await requireSession();

  if (isFeatureEnabled(feature, session.organization.plan)) {
    return <>{children}</>;
  }

  const required = minimumPlanFor(feature);

  return (
    <div className="rounded-xl border border-pand-border bg-pand-bg p-6">
      <p className="text-sm font-semibold text-pand-contorno">
        {required
          ? `Esta función requiere el plan ${PLAN_LABELS[required]}.`
          : "Esta función no está disponible en tu plan."}
      </p>
      <p className="mt-1 text-sm text-pand-gris">
        Tu plan actual es {PLAN_LABELS[session.organization.plan]}.
      </p>

      <Link
        href="/pricing"
        className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-pand-azul hover:underline"
      >
        Actualizar
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
