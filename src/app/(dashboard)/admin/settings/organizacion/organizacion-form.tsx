"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { Plan, Sector } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { saveOrganizacion } from "@/lib/config/actions";
import { MONEDAS, ZONAS_HORARIAS, type ZonaHoraria } from "@/lib/config/settings";

const SECTORES: { value: Sector; label: string }[] = [
  { value: "FINANCIAL", label: "Financiera" },
  { value: "B2B", label: "B2B / Mayorista" },
  { value: "TELECOM", label: "Telecomunicaciones" },
  { value: "RETAIL", label: "Retail" },
];

export function OrganizacionForm(props: {
  name: string;
  slug: string;
  sector: Sector;
  plan: Plan;
  currency: string;
  timezone: string;
}) {
  const [name, setName] = useState(props.name);
  const [sector, setSector] = useState<Sector>(props.sector);
  const [currency, setCurrency] = useState(props.currency);
  const [timezone, setTimezone] = useState<ZonaHoraria>(props.timezone as ZonaHoraria);
  const [saving, startSaving] = useTransition();

  const cambiado =
    name !== props.name ||
    sector !== props.sector ||
    currency !== props.currency ||
    timezone !== props.timezone;

  function guardar() {
    startSaving(async () => {
      const outcome = await saveOrganizacion({ name: name.trim(), sector, currency, timezone });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success("Configuración guardada.");
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">Organización</h2>
        <p className="mt-1 text-sm text-pand-gris">
          Los datos de tu empresa y cómo se muestran los montos y las fechas en todo
          el producto.
        </p>
      </header>

      <section className="space-y-5 rounded-card bg-white p-5 shadow-panel">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Nombre</Label>
            <Input
              id="org-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-sector">Rubro</Label>
            <NativeSelect
              id="org-sector"
              value={sector}
              onChange={(event) => setSector(event.target.value as Sector)}
            >
              {SECTORES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-pand-gris">
              Cambia cómo se llaman las columnas en el importador: una financiera
              manda cuotas y una distribuidora manda facturas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-currency">Moneda</Label>
            <NativeSelect
              id="org-currency"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {MONEDAS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-pand-gris">
              Es la moneda con la que se muestran los totales. Cada comprobante
              guarda la suya, así que cambiar esto no reescribe lo ya importado.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-timezone">Zona horaria</Label>
            <NativeSelect
              id="org-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value as ZonaHoraria)}
            >
              {ZONAS_HORARIAS.map((z) => (
                <option key={z} value={z}>
                  {z.replace("_", " ")}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-pand-gris">
              Define qué día es &laquo;hoy&raquo; para los vencimientos y los reportes.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-pand-border pt-4">
          <Button disabled={!cambiado || !name.trim() || saving} onClick={guardar}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
          {cambiado && (
            <span className="text-xs text-pand-gris">Hay cambios sin guardar.</span>
          )}
        </div>
      </section>

      {/* Lo que no se edita acá, pero conviene tener a la vista. */}
      <section className="rounded-card border border-pand-border bg-pand-bg p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
          Datos de la cuenta
        </p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-pand-gris">Identificador</dt>
            <dd className="mono">{props.slug}</dd>
          </div>
          <div>
            <dt className="text-xs text-pand-gris">Plan</dt>
            <dd className="mono">{props.plan}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-pand-gris">
          El identificador no se cambia: cualquier enlace guardado dejaría de
          funcionar. El plan se ajusta desde la administración de Pand.
        </p>
      </section>
    </div>
  );
}
