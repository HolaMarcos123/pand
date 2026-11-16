"use client";

import Link from "next/link";
import { Loader2, MailCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar() {
    if (!email.includes("@")) return;

    setEnviando(true);
    const supabase = createClient();

    // window.location.origin y no una variable de entorno: así el enlace vuelve
    // al mismo dominio desde el que se pidió, sea producción, una preview de
    // Vercel o localhost. Una variable mal configurada manda el correo a un
    // dominio donde la persona no está.
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/definir-password`,
    });

    // Se muestra el mismo mensaje exista o no la cuenta, y el error de Supabase
    // se ignora a propósito: responder distinto convierte esta pantalla en una
    // forma de averiguar qué emails tienen cuenta en Pand.
    setEnviando(false);
    setEnviado(true);
  }

  if (enviado) {
    return (
      <div>
        <MailCheck className="h-10 w-10 text-pand-azul" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Revisá tu correo</h1>
        <p className="mt-3 text-sm text-pand-gris">
          Si <span className="font-semibold">{email.trim()}</span> tiene una cuenta en
          Pand, le va a llegar un enlace para definir una contraseña nueva.
        </p>
        <p className="mt-3 text-sm text-pand-gris">
          El enlace vale una sola vez y por tiempo limitado. Si no aparece, mirá en
          spam.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block text-sm font-semibold text-pand-azul hover:underline"
        >
          Volver a ingresar
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl font-extrabold tracking-tight">Recuperar contraseña</h1>
      <p className="mt-2 text-sm text-pand-gris">
        Te mandamos un enlace para definir una nueva.
      </p>

      <div className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="vos@empresa.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") enviar();
            }}
          />
        </div>

        <Button
          className="w-full"
          disabled={!email.includes("@") || enviando}
          onClick={enviar}
        >
          {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Enviarme el enlace
        </Button>

        <Link
          href="/login"
          className="block text-center text-sm text-pand-gris hover:underline"
        >
          Volver
        </Link>
      </div>
    </div>
  );
}
