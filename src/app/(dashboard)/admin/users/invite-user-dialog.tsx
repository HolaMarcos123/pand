"use client";

import { UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useFormState } from "react-dom";
import { toast } from "sonner";

import { SubmitButton } from "@/components/auth/submit-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { inviteTeammate, type ActionState } from "@/lib/auth/actions";

const initialState: ActionState = {};

const ROLES = [
  { value: "OPERATOR", label: "Operador" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "ADMIN", label: "Administrador" },
];

export function InviteUserDialog({ seatsLeft }: { seatsLeft: number }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(inviteTeammate, initialState);

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.message) {
      toast.success(state.message);
      setOpen(false);
    }
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={seatsLeft <= 0}>
          <UserPlus className="mr-2 h-4 w-4" />
          Invitar usuario
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar usuario</DialogTitle>
          <DialogDescription>
            Le llega un email para poner su contraseña. Quedan {seatsLeft} lugares en
            tu plan.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="operador@empresa.com"
            />
            {state.fieldErrors?.email && (
              <p className="text-xs text-pand-coral">{state.fieldErrors.email[0]}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Rol</Label>
            <NativeSelect id="role" name="role" defaultValue="OPERATOR">
              {ROLES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <SubmitButton className="w-full">Enviar invitación</SubmitButton>
        </form>
      </DialogContent>
    </Dialog>
  );
}
