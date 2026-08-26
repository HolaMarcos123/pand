"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isRegistrationOpen } from "@/lib/auth/registration";
import { requireRole, requireSession } from "@/lib/auth/session";
import {
  inviteSchema,
  loginSchema,
  onboardingCompanySchema,
  registerSchema,
} from "@/lib/auth/schemas";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionState = {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

const TRIAL_DAYS = 14;

function slugify(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return base || "org";
}

async function uniqueSlug(base: string): Promise<string> {
  if (!(await prisma.organization.findUnique({ where: { slug: base } }))) {
    return base;
  }

  for (let i = 0; i < 5; i += 1) {
    const candidate = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await prisma.organization.findUnique({ where: { slug: candidate } }))) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}

// ─────────────────────────── Login ───────────────────────────

export async function signInAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Mensaje generico a proposito: distinguir "no existe" de "clave incorrecta"
    // le regala a un atacante una forma de enumerar cuentas.
    return { error: "Email o contraseña incorrectos." };
  }

  await prisma.user
    .update({
      where: { id: (await supabase.auth.getUser()).data.user!.id },
      data: { lastLoginAt: new Date() },
    })
    .catch(() => {
      // Un fallo acá no puede bloquear el login: es solo telemetría.
    });

  const redirectTo = String(formData.get("redirectTo") || "/overview");
  redirect(redirectTo.startsWith("/") ? redirectTo : "/overview");
}

// ─────────────────────────── Registro ───────────────────────────

export async function signUpAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // Esta es la barrera que cuenta. Que la pantalla no muestre el formulario no
  // impide que alguien invoque la action directamente.
  if (!isRegistrationOpen()) {
    return { error: "El registro está cerrado por ahora." };
  }

  const parsed = registerSchema.safeParse({
    companyName: formData.get("companyName"),
    sector: formData.get("sector"),
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
    country: formData.get("country"),
    currency: formData.get("currency"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const input = parsed.data;

  // Chequeo previo: cuando hay confirmacion de email activada, signUp() sobre un
  // email ya registrado devuelve un usuario ficticio en vez de un error. Sin este
  // corte terminariamos creando una organizacion duplicada para un id que no existe.
  if (await prisma.user.findFirst({ where: { email: input.email } })) {
    return { error: "Ya existe una cuenta con ese email." };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/login`,
    },
  });

  if (error) return { error: error.message };
  if (!data.user) return { error: "No se pudo crear la cuenta. Probá de nuevo." };

  const trialEnds = new Date();
  trialEnds.setDate(trialEnds.getDate() + TRIAL_DAYS);

  const slug = await uniqueSlug(slugify(input.companyName));

  // Organizacion y usuario van juntos o no van: un usuario sin organizacion no puede
  // entrar a ningun lado, y una organizacion sin admin queda huerfana.
  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: input.companyName,
        slug,
        sector: input.sector,
        plan: "STARTER",
        trialEnds,
        seatsUsed: 1,
        settings: { country: input.country, currency: input.currency },
      },
    });

    await tx.user.create({
      data: {
        id: data.user!.id,
        organizationId: organization.id,
        email: input.email,
        fullName: input.fullName,
        role: "ADMIN",
      },
    });
  });

  // Sin sesion = Supabase tiene la confirmacion por email activada.
  if (!data.session) {
    return {
      message:
        "Te mandamos un email para confirmar la cuenta. Revisá tu bandeja y volvé a entrar.",
    };
  }

  redirect("/onboarding");
}

// ─────────────────────────── Onboarding ───────────────────────────

export async function saveCompanyStep(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = onboardingCompanySchema.safeParse({
    name: formData.get("name"),
    timezone: formData.get("timezone"),
    currency: formData.get("currency"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const current = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { settings: true },
  });

  const settings =
    current.settings && typeof current.settings === "object"
      ? (current.settings as Record<string, unknown>)
      : {};

  await prisma.organization.update({
    where: { id: session.organization.id },
    data: {
      name: parsed.data.name,
      settings: {
        ...settings,
        timezone: parsed.data.timezone,
        currency: parsed.data.currency,
      },
    },
  });

  revalidatePath("/onboarding");
  return { message: "Datos de la empresa guardados." };
}

export async function inviteTeammate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireRole("ADMIN");

  const parsed = inviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const { email, role } = parsed.data;

  if (await prisma.user.findFirst({ where: { email } })) {
    return { error: "Ese email ya tiene cuenta en Pand." };
  }

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organization.id },
    select: { seatsUsed: true, seatsMax: true },
  });

  if (organization.seatsUsed >= organization.seatsMax) {
    return {
      error: `Tu plan permite ${organization.seatsMax} usuarios. Actualizá el plan para sumar más.`,
    };
  }

  let invitedId: string;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/login`,
    });

    if (error) return { error: error.message };
    if (!data.user) return { error: "No se pudo enviar la invitación." };

    invitedId = data.user.id;
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "No se pudo invitar al usuario.",
    };
  }

  await prisma.$transaction([
    prisma.user.create({
      data: {
        id: invitedId,
        organizationId: session.organization.id,
        email,
        fullName: email.split("@")[0],
        role,
      },
    }),
    prisma.organization.update({
      where: { id: session.organization.id },
      data: { seatsUsed: { increment: 1 } },
    }),
  ]);

  revalidatePath("/onboarding");
  revalidatePath("/admin/users");
  return { message: `Invitación enviada a ${email}.` };
}

export async function finishOnboarding(): Promise<void> {
  const session = await requireRole("ADMIN");

  await prisma.organization.update({
    where: { id: session.organization.id },
    data: { isOnboarded: true },
  });

  revalidatePath("/", "layout");
  redirect("/overview");
}
