"use client";

import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";

import { SubmitButton } from "@/components/auth/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { signUpAction, type ActionState } from "@/lib/auth/actions";
import { COUNTRIES, CURRENCIES, SECTORS } from "@/lib/auth/schemas";

const initialState: ActionState = {};

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-pand-coral">{messages[0]}</p>;
}

export function RegisterForm() {
  const [state, formAction] = useFormState(signUpAction, initialState);

  // La moneda sigue al país elegido, pero queda editable: una financiera paraguaya
  // puede tener cartera en dólares.
  const [country, setCountry] = useState<string>("PY");
  const [currency, setCurrency] = useState<string>("PYG");

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.message) toast.success(state.message);
  }, [state]);

  function handleCountryChange(value: string) {
    setCountry(value);
    const match = COUNTRIES.find((item) => item.value === value);
    if (match) setCurrency(match.currency);
  }

  if (state.message) {
    return (
      <div className="mt-8 rounded-xl border border-pand-border bg-white p-6">
        <p className="text-sm leading-relaxed text-pand-contorno">{state.message}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="companyName">Nombre de la empresa</Label>
        <Input id="companyName" name="companyName" placeholder="Financiera del Este" />
        <FieldError messages={state.fieldErrors?.companyName} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="sector">Sector</Label>
        <NativeSelect id="sector" name="sector" defaultValue="FINANCIAL">
          {SECTORS.map((sector) => (
            <option key={sector.value} value={sector.value}>
              {sector.label}
            </option>
          ))}
        </NativeSelect>
        <FieldError messages={state.fieldErrors?.sector} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="fullName">Tu nombre</Label>
        <Input id="fullName" name="fullName" autoComplete="name" />
        <FieldError messages={state.fieldErrors?.fullName} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email del administrador</Label>
        <Input id="email" name="email" type="email" autoComplete="email" />
        <FieldError messages={state.fieldErrors?.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Contraseña</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
        />
        <FieldError messages={state.fieldErrors?.password} />
        <p className="text-xs text-pand-gris">Mínimo 8 caracteres.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="country">País</Label>
          <NativeSelect
            id="country"
            name="country"
            value={country}
            onChange={(event) => handleCountryChange(event.target.value)}
          >
            {COUNTRIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={state.fieldErrors?.country} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="currency">Moneda</Label>
          <NativeSelect
            id="currency"
            name="currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            {CURRENCIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
          <FieldError messages={state.fieldErrors?.currency} />
        </div>
      </div>

      <SubmitButton className="w-full">Crear cuenta</SubmitButton>

      <p className="text-center text-xs text-pand-gris">
        14 días de prueba. No pedimos tarjeta.
      </p>
    </form>
  );
}
