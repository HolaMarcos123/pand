"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  BASE_DIAS,
  interesAcumulado,
  interesPorDia,
  type ConfigInteres,
} from "@/lib/collections/intereses";
import { saveCobranza } from "@/lib/config/actions";
import { MONEDAS } from "@/lib/config/settings";
import { formatCurrency } from "@/lib/format";

/** Un saldo de ejemplo para que la tasa se entienda en plata y no en teoría. */
const EJEMPLO = 5_000_000;
const EJEMPLO_USD = 1_000;

/** Un saldo con el que la tasa se lea bien en esa moneda. */
function ejemploDe(moneda: string): number {
  return moneda === "PYG" ? EJEMPLO : EJEMPLO_USD;
}

const numero = (texto: string) => Number(texto.replace(",", "."));
const valida = (texto: string) => {
  const valor = numero(texto);
  return Number.isFinite(valor) && valor >= 0 && valor <= 100;
};

export function CobranzaForm({
  cobranza,
  currency,
}: {
  cobranza: ConfigInteres;
  currency: string;
}) {
  const [general, setGeneral] = useState(String(cobranza.tasaMensual));
  const [porMoneda, setPorMoneda] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(cobranza.porMoneda).map(([m, t]) => [m, String(t)]),
    ),
  );
  const [saving, startSaving] = useTransition();

  const todoValido =
    valida(general) && Object.values(porMoneda).every((t) => valida(t));

  /** Las monedas del catálogo que todavía no tienen tasa propia. */
  const disponibles = MONEDAS.filter((m) => !(m.value in porMoneda));

  function agregar(moneda: string) {
    // Arranca en la tasa general: lo normal es ajustarla, no escribirla de cero.
    setPorMoneda((actual) => ({ ...actual, [moneda]: general }));
  }

  function quitar(moneda: string) {
    setPorMoneda((actual) => {
      const siguiente = { ...actual };
      delete siguiente[moneda];
      return siguiente;
    });
  }

  function guardar() {
    startSaving(async () => {
      const outcome = await saveCobranza({
        tasaMensual: numero(general),
        porMoneda: Object.fromEntries(
          Object.entries(porMoneda).map(([m, t]) => [m, numero(t)]),
        ),
      });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success("Tasas guardadas. La ficha del deudor ya las usa.");
    });
  }

  const configGeneral: ConfigInteres = {
    tasaMensual: valida(general) ? numero(general) : 0,
    porMoneda: {},
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">Cobranza</h2>
        <p className="mt-1 text-sm text-pand-gris">
          Parámetros que usa el panel de gestión para que el operador pueda
          contestar cuánto se debe hoy.
        </p>
      </header>

      <section className="space-y-5 rounded-card bg-white p-5 shadow-panel">
        <div className="space-y-1.5">
          <Label htmlFor="tasa">Interés por mora, mensual</Label>
          <div className="flex items-center gap-2">
            <Input
              id="tasa"
              inputMode="decimal"
              value={general}
              onChange={(event) => setGeneral(event.target.value)}
              className="w-[120px]"
            />
            <span className="text-sm text-pand-gris">% por mes</span>
          </div>
          {!valida(general) && (
            <p className="text-xs text-pand-coral">
              Tiene que ser un número entre 0 y 100.
            </p>
          )}
          <p className="text-xs text-pand-gris">
            En <span className="mono">0</span> el producto no muestra intereses en
            ningún lado. Es el valor por defecto, y el que usa toda moneda que no
            tenga el suyo acá abajo.
          </p>
        </div>

        {valida(general) && numero(general) > 0 && (
          <div className="rounded-card border border-pand-border bg-pand-bg p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
              Cómo se ve sobre un saldo de {formatCurrency(EJEMPLO, currency)}
            </p>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-pand-gris">Por día</dt>
                <dd className="mono">
                  {formatCurrency(interesPorDia(EJEMPLO, configGeneral), currency)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-pand-gris">A 30 días</dt>
                <dd className="mono">
                  {formatCurrency(
                    interesAcumulado(EJEMPLO, 30, configGeneral),
                    currency,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-pand-gris">A 90 días</dt>
                <dd className="mono">
                  {formatCurrency(
                    interesAcumulado(EJEMPLO, 90, configGeneral),
                    currency,
                  )}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </section>

      {/* Una tasa por moneda, porque nadie cobra lo mismo en guaraníes que en
          dólares: 4,5 % mensual es corriente en PYG y disparatado en USD. Con
          una sola tasa, la ficha de un deudor con prenda en dólares mostraba un
          interés que el operador no podía decir en voz alta. */}
      <section className="space-y-4 rounded-card bg-white p-5 shadow-panel">
        <div>
          <h3 className="text-sm font-bold">Tasas por moneda</h3>
          <p className="mt-1 text-sm text-pand-gris">
            Solo las que se cobran distinto. La moneda que no esté acá usa la tasa
            general.
          </p>
        </div>

        {Object.keys(porMoneda).length > 0 && (
          <ul className="space-y-3">
            {Object.entries(porMoneda).map(([moneda, tasa]) => {
              const config: ConfigInteres = {
                tasaMensual: 0,
                porMoneda: { [moneda]: valida(tasa) ? numero(tasa) : 0 },
              };
              const ejemplo = ejemploDe(moneda);

              return (
                <li
                  key={moneda}
                  className="flex flex-wrap items-center gap-3 rounded-card border border-pand-border p-3"
                >
                  <span className="mono w-12 shrink-0 text-sm font-semibold">
                    {moneda}
                  </span>

                  <Input
                    aria-label={`Tasa mensual en ${moneda}`}
                    inputMode="decimal"
                    value={tasa}
                    onChange={(event) =>
                      setPorMoneda((actual) => ({
                        ...actual,
                        [moneda]: event.target.value,
                      }))
                    }
                    className="w-[110px]"
                  />
                  <span className="text-sm text-pand-gris">% por mes</span>

                  {valida(tasa) ? (
                    <span className="mono ml-auto text-xs text-pand-gris">
                      {formatCurrency(ejemplo, moneda)} a 30 días ={" "}
                      <span className="font-semibold text-pand-contorno">
                        {formatCurrency(
                          interesAcumulado(ejemplo, 30, config, moneda),
                          moneda,
                        )}
                      </span>
                    </span>
                  ) : (
                    <span className="ml-auto text-xs text-pand-coral">
                      Tiene que ser un número entre 0 y 100.
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => quitar(moneda)}
                    aria-label={`Quitar la tasa de ${moneda}`}
                    title={`Quitar la tasa de ${moneda}: vuelve a usar la general`}
                    className="rounded-md p-1.5 text-pand-gris transition-colors hover:bg-pand-bg hover:text-pand-coral"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {disponibles.length > 0 && (
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-pand-gris" />
            <NativeSelect
              aria-label="Agregar una moneda con tasa propia"
              className="w-auto"
              value=""
              onChange={(event) => {
                if (event.target.value) agregar(event.target.value);
              }}
            >
              <option value="">Agregar moneda…</option>
              {disponibles.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
      </section>

      <Button disabled={!todoValido || saving} onClick={guardar}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Guardar
      </Button>

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
