"use client";

import { useEffect } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";

import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type ActionState } from "@/lib/auth/actions";

const initialState: ActionState = {};

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useFormState(signInAction, initialState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <input type="hidden" name="redirectTo" value={redirectTo ?? "/overview"} />

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="vos@empresa.com"
          aria-invalid={Boolean(state.fieldErrors?.email)}
        />
        {state.fieldErrors?.email && (
          <p className="text-xs text-pand-coral">{state.fieldErrors.email[0]}</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Contraseña</Label>
          <a
            href="/forgot-password"
            className="text-xs font-semibold text-pand-azul hover:underline"
          >
            ¿Olvidaste tu contraseña?
          </a>
        </div>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={Boolean(state.fieldErrors?.password)}
        />
        {state.fieldErrors?.password && (
          <p className="text-xs text-pand-coral">{state.fieldErrors.password[0]}</p>
        )}
      </div>

      <SubmitButton className="w-full">Ingresar</SubmitButton>
    </form>
  );
}
