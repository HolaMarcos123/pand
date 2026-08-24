import { Plan } from "@/generated/prisma/enums";

export type FeatureKey =
  | "ai_agent"
  | "ai_calls"
  | "erp_api"
  | "advanced_reports"
  | "whatsapp_bulk";

/**
 * Que desbloquea cada plan.
 *
 * El brief solo fija una regla dura: `ai_agent` y `ai_calls` son professional y
 * enterprise. El resto del reparto es un supuesto, derivado de que los pasos P06-P10
 * "justifican los planes Growth y Professional". Es una tabla, asi que moverlo
 * despues cuesta una linea.
 */
const FEATURES_BY_PLAN: Record<Plan, readonly FeatureKey[]> = {
  STARTER: [],
  GROWTH: ["erp_api", "whatsapp_bulk"],
  PROFESSIONAL: [
    "erp_api",
    "whatsapp_bulk",
    "advanced_reports",
    "ai_agent",
    "ai_calls",
  ],
  ENTERPRISE: [
    "erp_api",
    "whatsapp_bulk",
    "advanced_reports",
    "ai_agent",
    "ai_calls",
  ],
};

/** Nombre del plan minimo que incluye la feature, para el card de upgrade. */
const PLAN_ORDER: readonly Plan[] = [
  "STARTER",
  "GROWTH",
  "PROFESSIONAL",
  "ENTERPRISE",
];

export const PLAN_LABELS: Record<Plan, string> = {
  STARTER: "Starter",
  GROWTH: "Growth",
  PROFESSIONAL: "Professional",
  ENTERPRISE: "Enterprise",
};

export function isFeatureEnabled(feature: FeatureKey, plan: Plan): boolean {
  return FEATURES_BY_PLAN[plan].includes(feature);
}

/** El plan mas barato que habilita la feature. `null` si no la tiene ninguno. */
export function minimumPlanFor(feature: FeatureKey): Plan | null {
  return PLAN_ORDER.find((plan) => isFeatureEnabled(feature, plan)) ?? null;
}
