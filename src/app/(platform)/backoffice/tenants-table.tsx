"use client";

import { Loader2, PauseCircle, PlayCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { Plan } from "@/generated/prisma/enums";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { actualizarPlan, suspenderEmpresa } from "@/lib/platform/actions";
import type { TenantRow } from "@/lib/platform/queries";
import { cn } from "@/lib/utils";

const PLANES: Plan[] = ["STARTER", "GROWTH", "PROFESSIONAL", "ENTERPRISE"];

export function TenantsTable({
  tenants,
  propiaId,
}: {
  tenants: TenantRow[];
  /** La organización desde la que está logueado quien mira. No se suspende. */
  propiaId: string;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  // Confirmación de dos pasos para suspender, en vez de un window.confirm.
  // El diálogo nativo frena todo el browser y no se parece en nada al resto del
  // producto; acá el botón se transforma y queda a la vista qué va a pasar.
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan>("STARTER");
  const [asientos, setAsientos] = useState("3");
  const [trabajando, startTransition] = useTransition();

  function abrirEdicion(tenant: TenantRow) {
    setEditando(tenant.id);
    setPlan(tenant.plan);
    setAsientos(String(tenant.seatsMax));
  }

  function guardarPlan(tenant: TenantRow) {
    startTransition(async () => {
      const outcome = await actualizarPlan({
        organizationId: tenant.id,
        plan,
        seatsMax: Number(asientos),
      });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setEditando(null);
      toast.success(`${tenant.name}: plan actualizado.`);
    });
  }

  function cambiarSuspension(tenant: TenantRow) {
    const suspender = !tenant.suspendedAt;

    startTransition(async () => {
      const outcome = await suspenderEmpresa({ organizationId: tenant.id, suspender });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setConfirmando(null);
      toast.success(suspender ? `${tenant.name} suspendida.` : `${tenant.name} reactivada.`);
    });
  }

  if (tenants.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-white/20 p-12 text-center">
        <p className="font-semibold text-white">Todavía no hay empresas</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card bg-white/5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-pand-gris">
            <th className="px-4 py-3 font-semibold">Empresa</th>
            <th className="px-4 py-3 font-semibold">Plan</th>
            <th className="px-4 py-3 text-right font-semibold">Usuarios</th>
            <th className="px-4 py-3 text-right font-semibold">Deudores</th>
            <th className="px-4 py-3 text-right font-semibold">Cartera</th>
            <th className="px-4 py-3 font-semibold">Últ. actividad</th>
            <th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>

        <tbody>
          {tenants.map((tenant) => {
            const suspendida = Boolean(tenant.suspendedAt);
            const sinActividad = !tenant.ultimaActividad;
            const enEdicion = editando === tenant.id;

            return (
              <tr
                key={tenant.id}
                className={cn(
                  "border-b border-white/5 text-white",
                  suspendida && "opacity-50",
                )}
              >
                <td className="px-4 py-3">
                  <span className="font-semibold">{tenant.name}</span>
                  <span className="mono ml-2 text-xs text-pand-gris">{tenant.slug}</span>
                  {tenant.id === propiaId && (
                    <span className="ml-2 rounded-badge bg-pand-celeste px-1.5 py-0.5 text-[10px] font-semibold uppercase text-pand-contorno">
                      La tuya
                    </span>
                  )}
                </td>

                <td className="px-4 py-3">
                  {enEdicion ? (
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`Plan de ${tenant.name}`}
                        value={plan}
                        onChange={(event) => setPlan(event.target.value as Plan)}
                        className="rounded-md bg-pand-contorno px-2 py-1 text-xs text-white"
                      >
                        {PLANES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Asientos de ${tenant.name}`}
                        type="number"
                        min={1}
                        value={asientos}
                        onChange={(event) => setAsientos(event.target.value)}
                        className="w-16 rounded-md bg-pand-contorno px-2 py-1 text-xs text-white"
                      />
                    </div>
                  ) : (
                    <>
                      <span className="mono text-xs">{tenant.plan}</span>
                      {tenant.trialEnds && (
                        <span className="ml-2 text-[11px] text-pand-celeste">
                          prueba hasta {formatDate(tenant.trialEnds)}
                        </span>
                      )}
                    </>
                  )}
                </td>

                <td className="mono px-4 py-3 text-right">
                  {formatNumber(tenant.usuarios)}
                  <span className="text-pand-gris"> / {tenant.seatsMax}</span>
                </td>

                <td className="mono px-4 py-3 text-right">
                  {formatNumber(tenant.deudores)}
                </td>

                <td className="mono whitespace-nowrap px-4 py-3 text-right">
                  {formatCurrency(tenant.carteraAbierta, "PYG")}
                </td>

                <td className="mono px-4 py-3 text-xs">
                  {sinActividad ? (
                    <span className="text-pand-coral">sin uso</span>
                  ) : (
                    formatDate(tenant.ultimaActividad)
                  )}
                </td>

                <td className="px-4 py-3">
                  {suspendida ? (
                    <span className="text-xs font-semibold text-pand-coral">
                      Suspendida {formatDate(tenant.suspendedAt)}
                    </span>
                  ) : (
                    <span className="text-xs text-pand-gris">Activa</span>
                  )}
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {enEdicion ? (
                      <>
                        <button
                          type="button"
                          disabled={trabajando}
                          onClick={() => guardarPlan(tenant)}
                          className="rounded-md bg-pand-azul px-2.5 py-1 text-xs font-semibold text-white"
                        >
                          {trabajando ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Guardar"
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditando(null)}
                          className="text-xs text-pand-gris hover:text-white"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => abrirEdicion(tenant)}
                        className="rounded-md border border-white/20 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/10"
                      >
                        Plan
                      </button>
                    )}

                    {tenant.id !== propiaId &&
                      (confirmando === tenant.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-pand-coral">
                            ¿Dejar afuera a sus {formatNumber(tenant.usuarios)}{" "}
                            usuarios?
                          </span>
                          <button
                            type="button"
                            disabled={trabajando}
                            onClick={() => cambiarSuspension(tenant)}
                            className="rounded-md bg-pand-coral px-2.5 py-1 text-xs font-semibold text-white"
                          >
                            Suspender
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmando(null)}
                            className="text-xs text-pand-gris hover:text-white"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={trabajando}
                          onClick={() =>
                            suspendida
                              ? cambiarSuspension(tenant)
                              : setConfirmando(tenant.id)
                          }
                          title={suspendida ? "Reactivar" : "Suspender"}
                          className={cn(
                            "rounded-md p-1.5 transition-colors",
                            suspendida
                              ? "text-pand-celeste hover:bg-white/10"
                              : "text-pand-gris hover:bg-white/10 hover:text-pand-coral",
                          )}
                        >
                          {suspendida ? (
                            <PlayCircle className="h-4 w-4" />
                          ) : (
                            <PauseCircle className="h-4 w-4" />
                          )}
                        </button>
                      ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
