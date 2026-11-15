"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult, ActionType } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTipificaciones } from "@/lib/config/actions";
import type { Tipificaciones } from "@/lib/config/settings";
import { ACTION_RESULT_LABELS, ACTION_TYPE_LABELS } from "@/lib/tasks/action-config";
import { cn } from "@/lib/utils";

type Estado = {
  tipos: Record<string, { label: string; activo: boolean; resultados: ActionResult[] }>;
  etiquetasResultado: Record<string, string>;
};

export function TipificacionesForm({
  config,
  permitidos,
}: {
  config: Tipificaciones;
  permitidos: Record<ActionType, ActionResult[]>;
}) {
  const [estado, setEstado] = useState<Estado>(() => ({
    tipos: Object.fromEntries(
      config.tipos.map((t) => [
        t.tipo,
        { label: t.label, activo: t.activo, resultados: [...t.resultados] },
      ]),
    ),
    etiquetasResultado: { ...config.etiquetasResultado },
  }));
  const [saving, startSaving] = useTransition();

  const manuales = config.tipos.filter((t) => t.manual);
  const delSistema = config.tipos.filter((t) => !t.manual);

  function setTipo(tipo: string, cambio: Partial<Estado["tipos"][string]>) {
    setEstado((actual) => ({
      ...actual,
      tipos: { ...actual.tipos, [tipo]: { ...actual.tipos[tipo], ...cambio } },
    }));
  }

  function toggleResultado(tipo: string, resultado: ActionResult) {
    const actuales = estado.tipos[tipo].resultados;
    setTipo(tipo, {
      resultados: actuales.includes(resultado)
        ? actuales.filter((r) => r !== resultado)
        : [...actuales, resultado],
    });
  }

  function restaurar() {
    setEstado({
      tipos: Object.fromEntries(
        config.tipos.map((t) => [
          t.tipo,
          {
            label: ACTION_TYPE_LABELS[t.tipo],
            activo: true,
            resultados: [...permitidos[t.tipo]],
          },
        ]),
      ),
      etiquetasResultado: { ...ACTION_RESULT_LABELS },
    });
  }

  function guardar() {
    startSaving(async () => {
      const outcome = await saveTipificaciones({
        tipificaciones: {
          tipos: Object.fromEntries(
            Object.entries(estado.tipos).map(([tipo, valor]) => [
              tipo,
              { label: valor.label.trim(), activo: valor.activo, resultados: valor.resultados },
            ]),
          ),
          etiquetasResultado: Object.fromEntries(
            Object.entries(estado.etiquetasResultado).map(([r, label]) => [r, label.trim()]),
          ),
        },
      });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success("Tipificaciones guardadas.");
    });
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-bold">Tipificaciones</h2>
        <p className="mt-1 text-sm text-pand-gris">
          Cómo llama tu equipo a cada gestión y a cada resultado, y qué resultados
          se ofrecen al cargar cada tipo.
        </p>
      </header>

      {/* Es importante decir esto acá y no esconderlo en la documentación: el
          operador va a querer inventar resultados nuevos y conviene que entienda
          por qué no se puede. */}
      <p className="rounded-card border border-pand-border bg-pand-bg p-4 text-sm text-pand-gris">
        Podés renombrar y apagar tipificaciones, pero no crear resultados nuevos.
        Pand necesita saber cuál de ellos significa <strong>prometió pagar</strong>{" "}
        para armar el reporte de promesas, y cuáles significan que{" "}
        <strong>no había nadie del otro lado</strong> para medir contactabilidad.
        Con nombres libres esos dos reportes se quedarían sin forma de clasificar.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Tipos que carga el operador</h3>

        {manuales.map((tipo) => {
          const valor = estado.tipos[tipo.tipo];
          const opciones = permitidos[tipo.tipo];

          return (
            <div
              key={tipo.tipo}
              className={cn(
                "rounded-card bg-white p-5 shadow-card transition-opacity",
                !valor.activo && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={valor.activo}
                    onChange={(event) => setTipo(tipo.tipo, { activo: event.target.checked })}
                    className="h-4 w-4 rounded border-pand-border"
                  />
                  <span className="text-sm font-semibold">Activo</span>
                </label>

                <Input
                  aria-label={`Nombre de ${ACTION_TYPE_LABELS[tipo.tipo]}`}
                  value={valor.label}
                  maxLength={40}
                  onChange={(event) => setTipo(tipo.tipo, { label: event.target.value })}
                  className="h-9 w-[220px]"
                />

                <span className="mono text-xs text-pand-gris">{tipo.tipo}</span>
              </div>

              {opciones.length > 0 && (
                <div className="mt-4 border-t border-pand-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
                    Resultados que se ofrecen
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {opciones.map((resultado) => {
                      const elegido = valor.resultados.includes(resultado);
                      return (
                        <button
                          key={resultado}
                          type="button"
                          disabled={!valor.activo}
                          onClick={() => toggleResultado(tipo.tipo, resultado)}
                          className={cn(
                            "rounded-badge border px-3 py-1.5 text-xs font-semibold transition-colors",
                            elegido
                              ? "border-pand-azul bg-pand-azul text-white"
                              : "border-pand-border text-pand-gris hover:text-pand-contorno",
                          )}
                        >
                          {estado.etiquetasResultado[resultado]}
                        </button>
                      );
                    })}
                  </div>
                  {valor.activo && valor.resultados.length === 0 && (
                    <p className="mt-2 text-xs text-pand-coral">
                      Sin resultados, el operador no va a poder cerrar una gestión de
                      este tipo.
                    </p>
                  )}
                </div>
              )}

              {tipo.tipo === "NOTE" && (
                <p className="mt-3 text-xs text-pand-gris">
                  Una nota es una anotación, no un intento de contacto: no lleva
                  resultado y no cuenta para la contactabilidad.
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Nombre de cada resultado</h3>
        <div className="grid gap-3 rounded-card bg-white p-5 shadow-card sm:grid-cols-2">
          {Object.keys(ACTION_RESULT_LABELS).map((resultado) => (
            <div key={resultado} className="space-y-1">
              <label
                htmlFor={`res-${resultado}`}
                className="mono block text-[11px] text-pand-gris"
              >
                {resultado}
              </label>
              <Input
                id={`res-${resultado}`}
                value={estado.etiquetasResultado[resultado]}
                maxLength={40}
                onChange={(event) =>
                  setEstado((actual) => ({
                    ...actual,
                    etiquetasResultado: {
                      ...actual.etiquetasResultado,
                      [resultado]: event.target.value,
                    },
                  }))
                }
                className="h-9"
              />
            </div>
          ))}
        </div>
      </section>

      {delSistema.length > 0 && (
        <section className="rounded-card border border-pand-border bg-pand-bg p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
            Las crea el sistema
          </p>
          <p className="mt-2 text-sm text-pand-gris">
            {delSistema.map((t) => t.label).join(" · ")}. No se cargan a mano: las
            genera el producto cuando registra un compromiso o cuando responde el
            agente de llamadas.
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={saving || Object.values(estado.tipos).every((t) => !t.activo)}
          onClick={guardar}
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar tipificaciones
        </Button>
        <Button variant="outline" disabled={saving} onClick={restaurar}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Volver a los valores de fábrica
        </Button>
      </div>
    </div>
  );
}
