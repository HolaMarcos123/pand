import { z } from "zod";

export const SECTORS = [
  { value: "FINANCIAL", label: "Financiero" },
  { value: "B2B", label: "B2B" },
  { value: "TELECOM", label: "Telco" },
  { value: "RETAIL", label: "Retail" },
] as const;

export const COUNTRIES = [
  { value: "PY", label: "Paraguay", currency: "PYG" },
  { value: "AR", label: "Argentina", currency: "ARS" },
  { value: "BR", label: "Brasil", currency: "BRL" },
  { value: "UY", label: "Uruguay", currency: "USD" },
  { value: "OT", label: "Otro", currency: "USD" },
] as const;

export const CURRENCIES = [
  { value: "PYG", label: "Guaraní (Gs.)" },
  { value: "USD", label: "Dólar (US$)" },
  { value: "ARS", label: "Peso argentino ($)" },
  { value: "BRL", label: "Real (R$)" },
] as const;

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Ingresá tu email").email("Email inválido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export const registerSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(2, "El nombre de la empresa es muy corto")
    .max(80, "Máximo 80 caracteres"),
  sector: z.enum(["FINANCIAL", "B2B", "TELECOM", "RETAIL"], {
    message: "Elegí un sector",
  }),
  fullName: z.string().trim().min(2, "Ingresá tu nombre").max(80),
  email: z.string().trim().min(1, "Ingresá tu email").email("Email inválido"),
  // 8 caracteres es el minimo que exige Supabase Auth por defecto.
  password: z.string().min(8, "La contraseña necesita al menos 8 caracteres"),
  country: z.enum(["PY", "AR", "BR", "UY", "OT"], { message: "Elegí un país" }),
  currency: z.enum(["PYG", "USD", "ARS", "BRL"], { message: "Elegí una moneda" }),
});

export const onboardingCompanySchema = z.object({
  name: z.string().trim().min(2, "El nombre es muy corto").max(80),
  timezone: z.string().trim().min(1, "Elegí una zona horaria"),
  currency: z.enum(["PYG", "USD", "ARS", "BRL"], { message: "Elegí una moneda" }),
});

export const inviteSchema = z.object({
  email: z.string().trim().min(1, "Ingresá un email").email("Email inválido"),
  role: z.enum(["ADMIN", "SUPERVISOR", "OPERATOR"], { message: "Elegí un rol" }),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type OnboardingCompanyInput = z.infer<typeof onboardingCompanySchema>;
