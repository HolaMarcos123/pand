import type { ActionResult, ActionType } from "@/generated/prisma/enums";

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  CALL: "Llamada",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  VISIT: "Visita",
  SMS: "SMS",
  NOTE: "Nota",
  PROMISE: "Compromiso",
  AI_CALL: "Llamada IA",
};

export const ACTION_RESULT_LABELS: Record<ActionResult, string> = {
  NO_ANSWER: "No atiende",
  BUSY: "Ocupado",
  PROMISE_PAY: "Promete pagar",
  REFUSED: "Se niega",
  PAID: "Ya pagó",
  CALLBACK: "Pide que lo llamen",
  WRONG_NUMBER: "Número equivocado",
};

/**
 * Resultados posibles según el tipo de gestión.
 *
 * El brief pide que el selector de resultado sea dinámico, y tiene sentido: "Ocupado"
 * no existe para un email, y ofrecerlo invita a cargar datos que después ensucian los
 * reportes de efectividad por canal.
 *
 * `NOTE` no lleva resultado: es una anotación, no un intento de contacto.
 */
export const RESULTS_BY_TYPE: Record<ActionType, ActionResult[]> = {
  CALL: [
    "NO_ANSWER",
    "BUSY",
    "PROMISE_PAY",
    "REFUSED",
    "PAID",
    "CALLBACK",
    "WRONG_NUMBER",
  ],
  AI_CALL: ["NO_ANSWER", "BUSY", "PROMISE_PAY", "REFUSED", "PAID", "WRONG_NUMBER"],
  // Los canales escritos no tienen "ocupado": o llega y responden, o no responden.
  WHATSAPP: ["NO_ANSWER", "PROMISE_PAY", "REFUSED", "PAID", "CALLBACK", "WRONG_NUMBER"],
  SMS: ["NO_ANSWER", "PROMISE_PAY", "REFUSED", "PAID", "WRONG_NUMBER"],
  EMAIL: ["NO_ANSWER", "PROMISE_PAY", "REFUSED", "PAID", "WRONG_NUMBER"],
  VISIT: ["NO_ANSWER", "PROMISE_PAY", "REFUSED", "PAID", "CALLBACK"],
  PROMISE: ["PROMISE_PAY"],
  NOTE: [],
};

/** Tipos que el operador puede cargar a mano. AI_CALL la crea el webhook del P10. */
export const MANUAL_ACTION_TYPES: ActionType[] = [
  "CALL",
  "WHATSAPP",
  "EMAIL",
  "SMS",
  "VISIT",
  "NOTE",
];

/** Un teléfono paraguayo local sirve para wa.me solo con el prefijo de país. */
export function toWhatsappNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  // 0981… → 595981…: se saca el cero de trunk y se antepone Paraguay.
  if (digits.startsWith("0")) return `595${digits.slice(1)}`;
  return digits;
}
