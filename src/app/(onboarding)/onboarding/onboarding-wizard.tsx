"use client";

import { Check, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";

import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  finishOnboarding,
  inviteTeammate,
  saveCompanyStep,
  type ActionState,
} from "@/lib/auth/actions";
import { CURRENCIES } from "@/lib/auth/schemas";

const TIMEZONES = [
  { value: "America/Asuncion", label: "Asunción (GMT-3)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (GMT-3)" },
  { value: "America/Sao_Paulo", label: "São Paulo (GMT-3)" },
  { value: "America/Montevideo", label: "Montevideo (GMT-3)" },
  { value: "UTC", label: "UTC" },
];

const ROLES = [
  { value: "OPERATOR", label: "Operador" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "ADMIN", label: "Administrador" },
];

const STEPS = ["Empresa", "Equipo", "Cartera"] as const;

const initialState: ActionState = {};

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={[
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                done && "bg-pand-azul text-white",
                active && "bg-pand-celeste text-pand-contorno",
                !done && !active && "bg-pand-border text-pand-gris",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span
              className={
                active
                  ? "text-sm font-semibold text-pand-contorno"
                  : "text-sm text-pand-gris"
              }
            >
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="ml-1 hidden h-px flex-1 bg-pand-border sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function OnboardingWizard({
  organizationName,
  currency,
  timezone,
}: {
  organizationName: string;
  currency: string;
  timezone: string;
}) {
  const [step, setStep] = useState(0);

  const [companyState, companyAction] = useFormState(saveCompanyStep, initialState);
  const [inviteState, inviteAction] = useFormState(inviteTeammate, initialState);
  const [invited, setInvited] = useState<string[]>([]);

  useEffect(() => {
    if (companyState.error) toast.error(companyState.error);
    if (companyState.message) {
      toast.success(companyState.message);
      setStep(1);
    }
  }, [companyState]);

  useEffect(() => {
    if (inviteState.error) toast.error(inviteState.error);
    if (inviteState.message) {
      toast.success(inviteState.message);
      // El mensaje trae el email al final: "Invitación enviada a x@y.com."
      setInvited((prev) => [...prev, inviteState.message!.split(" ").pop()!]);
    }
  }, [inviteState]);

  return (
    <div className="w-full max-w-lg">
      <Stepper current={step} />

      <div className="mt-8 rounded-xl border border-pand-border bg-white p-6 shadow-sm">
        {step === 0 && (
          <form action={companyAction} className="space-y-5">
            <div>
              <h2 className="text-xl font-bold">Configurá tu empresa</h2>
              <p className="mt-1 text-sm text-pand-gris">
                Con esto ajustamos fechas y formatos de moneda en toda la app.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">Nombre</Label>
              <Input id="name" name="name" defaultValue={organizationName} />
              {companyState.fieldErrors?.name && (
                <p className="text-xs text-pand-coral">
                  {companyState.fieldErrors.name[0]}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">Zona horaria</Label>
              <NativeSelect id="timezone" name="timezone" defaultValue={timezone}>
                {TIMEZONES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currency">Moneda</Label>
              <NativeSelect id="currency" name="currency" defaultValue={currency}>
                {CURRENCIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <SubmitButton className="w-full">Guardar y seguir</SubmitButton>
          </form>
        )}

        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold">Invitá a tu equipo</h2>
              <p className="mt-1 text-sm text-pand-gris">
                Les llega un email para poner su contraseña. Podés sumar más después.
              </p>
            </div>

            <form action={inviteAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="operador@empresa.com"
                />
                {inviteState.fieldErrors?.email && (
                  <p className="text-xs text-pand-coral">
                    {inviteState.fieldErrors.email[0]}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="invite-role">Rol</Label>
                <NativeSelect id="invite-role" name="role" defaultValue="OPERATOR">
                  {ROLES.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <SubmitButton className="w-full">Enviar invitación</SubmitButton>
            </form>

            {invited.length > 0 && (
              <ul className="space-y-1 rounded-lg bg-pand-bg p-3">
                {invited.map((email) => (
                  <li
                    key={email}
                    className="flex items-center gap-2 text-sm text-pand-gris"
                  >
                    <Check className="h-4 w-4 text-pand-azul" />
                    {email}
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-3 border-t border-pand-border pt-4">
              <Button variant="outline" onClick={() => setStep(0)} className="flex-1">
                Atrás
              </Button>
              <Button onClick={() => setStep(2)} className="flex-1">
                Continuar
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold">Subí tu primera cartera</h2>
              <p className="mt-1 text-sm text-pand-gris">
                Un Excel o CSV con tus deudores. Este paso podés saltearlo.
              </p>
            </div>

            <div className="rounded-xl border-2 border-dashed border-pand-border bg-pand-bg p-8 text-center">
              <Upload className="mx-auto h-8 w-8 text-pand-gris" />
              <p className="mt-3 text-sm font-semibold text-pand-contorno">
                Carga de carteras
              </p>
              <p className="mt-1 text-xs text-pand-gris">
                El importador con mapeo de columnas llega en el paso P04.
              </p>
            </div>

            <div className="flex gap-3 border-t border-pand-border pt-4">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">
                Atrás
              </Button>
              <form action={finishOnboarding} className="flex-1">
                <SubmitButton className="w-full">Terminar</SubmitButton>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
