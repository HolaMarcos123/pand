"use client";

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

/**
 * Boton de submit que se deshabilita solo mientras corre la server action.
 * useFormStatus lee el estado del <form> padre, por eso tiene que ser un componente
 * aparte: dentro del mismo componente que renderiza el form siempre devuelve false.
 */
export function SubmitButton({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} className={className}>
      {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  );
}
