"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BASE_DIAS,
  interesAcumulado,
  interesPorDia,
} from "@/lib/collections/intereses";
import { saveCobranza } from "@/lib/config/actions";
import { formatCurrency } from "@/lib/format";

/** Un saldo de ejemplo para que la tasa se entienda en guaraníes y no en teoría. */
const EJEMPLO = 5_000_000;

export function CobranzaForm({
  tasaMensual,
  currency,
}: {
  tasaMensual: number;
  currency: string;
}) {
  const [tasa, setTasa] = useState(String(tasaMensual));
  const [saving, startSaving] = useTransition();

  const valor = Number(tasa.replace(",", "."));
  const valida = Number.isFinite(valor) && valor >= 0 && valor <= 100;
  const config = { tasaMensual: valida ? valor : 0 };

  function guardar() {
    startSaving(async () => {
      const outcome = await saveCobranza({ tasaMensual: valor });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success(
        valor > 0
          ? "Tasa guardada. La ficha del deudor ya muestra el interés."
          : "Interés desactivado: la ficha deja de mostrarlo.",
      );
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">Cobranza</h2>
        <p className="mt-1 text-sm text-pand-gris">
          Parámetros que usa el panel de gestión para que el operador pueda
          contestar cuánto se debe hoy.
        </p>
      </header>

      <section className="space-y-5 rounded-card bg-white p-5 shadow-card">
        <div className="space-y-1.5">
          <Label htmlFor="tasa">Interés por mora, mensual</Label>
          <div className="flex items-center gap-2">
            <Input
              id="tasa"
              inputMode="decimal"
              value={tasa}
              onChange={(event) => setTasa(event.target.value)}
              className="w-[120px]"
            />
            <span className="text-sm text-pand-gris">% por mes</span>
          </div>
          {!valida && (
            <p className="text-xs text-pand-coral">
              Tiene que ser un número entre 0 y 100.
            </p>
          )}
          <p className="text-xs text-pand-gris">
            En <span className="mono">0</span> el producto no muestra intereses en
            ningún lado. Es el valor por defecto.
          </p>
        </div>

        {valida && valor > 0 && (
          <div className="rounded-card border border-pand-border bg-pand-bg p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
              Cómo se ve sobre un saldo de {formatCurrency(EJEMPLO, currency)}
            </p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-pand-gris">Por día</dt>
                <dd className="mono">
                  {formatCurrency(interesPorDia(EJEMPLO, config), currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-pand-gris">A 30 días</dt>
                <dd className="mono">
                  {formatCurrency(interesAcumulado(EJEMPLO, 30, config), currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-pand-gris">A 90 días</dt>
                <dd className="mono">
                  {formatCurrency(interesAcumulado(EJEMPLO, 90, config), currency)}
                </dd>
              </div>
            </dl>
          </div>
        )}

        <Button
          disabled={!valida || saving || valor === tasaMensual}
          onClick={guardar}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar
        </Button>
      </section>

      {/* Esto no es letra chica: el operador le dice este número al deudor por
          teléfono, y conviene que quien configura la tasa sepa qué está
          habilitando. */}
      <section className="rounded-card border border-pand-coral/30 bg-pand-coral/5 p-5">
        <p className="text-sm font-semibold">Es una estimación, no el saldo legal</p>
        <p className="mt-2 text-sm text-pand-gris">
          Pand calcula interés simple sobre el saldo impago, dividiendo la tasa
          mensual por {BASE_DIAS} días. No capitaliza, no conoce los días de gracia
          de cada contrato ni los gastos administrativos: todo eso lo liquida el
          sistema del acreedor.
        </p>
        <p className="mt-2 text-sm text-pand-gris">
          Sirve para que el operador pueda contestar «¿cuánto debo hoy?» con un
          orden de magnitud correcto en vez de cortar y averiguar — que es como se
          pierde una promesa de pago. Para un acuerdo formal, vale el número del
          sistema de origen.
        </p>
      </section>
    </div>
  );
}
