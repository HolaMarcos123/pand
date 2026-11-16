"use client";

import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { Plan, Sector } from "@/generated/prisma/enums";
import { crearEmpresa } from "@/lib/platform/actions";

const SECTORES: { value: Sector; label: string }[] = [
  { value: "FINANCIAL", label: "Financiera" },
  { value: "B2B", label: "B2B / Mayorista" },
  { value: "TELECOM", label: "Telecomunicaciones" },
  { value: "RETAIL", label: "Retail" },
];

const PLANES: { value: Plan; label: string; asientos: number }[] = [
  { value: "STARTER", label: "Starter", asientos: 3 },
  { value: "GROWTH", label: "Growth", asientos: 10 },
  { value: "PROFESSIONAL", label: "Professional", asientos: 25 },
  { value: "ENTERPRISE", label: "Enterprise", asientos: 100 },
];

const campo =
  "w-full rounded-lg border border-white/15 bg-pand-contorno px-3 py-2 text-sm text-white placeholder:text-pand-gris focus:border-pand-celeste focus:outline-none";

export function AltaForm() {
  const router = useRouter();
  const [nombre, setNombre] = useState("");
  const [sector, setSector] = useState<Sector>("FINANCIAL");
  const [plan, setPlan] = useState<Plan>("STARTER");
  const [emailAdmin, setEmailAdmin] = useState("");
  const [diasDePrueba, setDiasDePrueba] = useState("14");
  const [creando, startCreando] = useTransition();

  const asientos = PLANES.find((p) => p.value === plan)?.asientos ?? 3;
  const listo = nombre.trim().length >= 2 && emailAdmin.includes("@");

  function crear() {
    startCreando(async () => {
      const outcome = await crearEmpresa({
        nombre: nombre.trim(),
        sector,
        plan,
        emailAdmin: emailAdmin.trim(),
        diasDePrueba: Number(diasDePrueba) || 0,
      });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }

      toast.success(`${nombre.trim()} creada. Se envió la invitación a ${emailAdmin.trim()}.`);
      router.push("/backoffice");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 rounded-card bg-white/5 p-6">
      <div className="space-y-1.5">
        <label htmlFor="nombre" className="text-sm font-semibold text-white">
          Nombre de la empresa
        </label>
        <input
          id="nombre"
          value={nombre}
          maxLength={80}
          placeholder="Financiera Prestigio"
          onChange={(event) => setNombre(event.target.value)}
          className={campo}
        />
        <p className="text-xs text-pand-gris">
          De acá sale el identificador de la cuenta, que después no se cambia.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="sector" className="text-sm font-semibold text-white">
            Rubro
          </label>
          <select
            id="sector"
            value={sector}
            onChange={(event) => setSector(event.target.value as Sector)}
            className={campo}
          >
            {SECTORES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="plan" className="text-sm font-semibold text-white">
            Plan
          </label>
          <select
            id="plan"
            value={plan}
            onChange={(event) => setPlan(event.target.value as Plan)}
            className={campo}
          >
            {PLANES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-pand-gris">
            Arranca con {asientos} usuarios. Se ajusta después desde la lista.
          </p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-semibold text-white">
            Email del primer administrador
          </label>
          <input
            id="email"
            type="email"
            value={emailAdmin}
            placeholder="gerencia@prestigio.com.py"
            onChange={(event) => setEmailAdmin(event.target.value)}
            className={campo}
          />
          <p className="text-xs text-pand-gris">
            Le llega una invitación para poner su contraseña.
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="prueba" className="text-sm font-semibold text-white">
            Días de prueba
          </label>
          <input
            id="prueba"
            type="number"
            min={0}
            max={365}
            value={diasDePrueba}
            onChange={(event) => setDiasDePrueba(event.target.value)}
            className={campo}
          />
          <p className="text-xs text-pand-gris">0 si ya es un cliente pago.</p>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          disabled={!listo || creando}
          onClick={crear}
          className="flex items-center rounded-lg bg-pand-azul px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {creando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Crear e invitar
        </button>
        <p className="text-xs text-pand-gris">
          Se crean la empresa y su administrador juntos, o no se crea nada.
        </p>
      </div>
    </div>
  );
}
