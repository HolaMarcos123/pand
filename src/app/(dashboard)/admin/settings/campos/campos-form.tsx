"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { saveCamposPropios } from "@/lib/config/actions";
import {
  MAX_CAMPOS_PROPIOS,
  TIPOS_DE_CAMPO,
  idDeCampo,
  type CampoPropio,
  type TipoDeCampo,
} from "@/lib/config/settings";

/**
 * Una fila en edición. Arrastra el `id` original para distinguir un campo que
 * ya existía —y por lo tanto tiene datos importados colgando— de uno nuevo.
 */
type Fila = CampoPropio & { original: string | null };

export function CamposForm({ campos }: { campos: CampoPropio[] }) {
  const [filas, setFilas] = useState<Fila[]>(
    campos.map((c) => ({ ...c, original: c.id })),
  );
  const [saving, startSaving] = useTransition();

  function agregar() {
    setFilas((f) => [
      ...f,
      { id: "", label: "", tipo: "texto", enFicha: true, original: null },
    ]);
  }

  function cambiar(indice: number, cambio: Partial<Fila>) {
    setFilas((f) => f.map((fila, i) => (i === indice ? { ...fila, ...cambio } : fila)));
  }

  function borrar(indice: number) {
    setFilas((f) => f.filter((_, i) => i !== indice));
  }

  function guardar() {
    const limpias = filas
      .map((f) => ({
        // El id de un campo que ya existía no se recalcula aunque se renombre
        // la etiqueta: lo ya importado quedó guardado bajo el id viejo.
        id: f.original ?? idDeCampo(f.label),
        label: f.label.trim(),
        tipo: f.tipo,
        enFicha: f.enFicha,
      }))
      .filter((f) => f.label.length > 0 && f.id.length > 0);

    startSaving(async () => {
      const outcome = await saveCamposPropios({ campos: limpias });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      setFilas(limpias.map((c) => ({ ...c, original: c.id })));
      toast.success(
        limpias.length === 0
          ? "No quedaron campos propios."
          : `${limpias.length} campo${limpias.length === 1 ? "" : "s"} guardado${
              limpias.length === 1 ? "" : "s"
            }. Ya aparecen al importar una cartera.`,
      );
    });
  }

  const borrados = campos.filter((c) => !filas.some((f) => f.original === c.id));

  return (
    <div className="space-y-6 rounded-card bg-white p-6 shadow-card">
      <div>
        <h2 className="text-xl font-bold">Campos propios</h2>
        <p className="mt-1 max-w-2xl text-sm text-pand-gris">
          Las columnas de tu planilla que Pand no conoce: la sucursal, el auxiliar
          de cobranza, el número de factura de tu sistema. Declaralas acá y
          después aparecen al mapear una cartera, como cualquier otro campo.
        </p>
      </div>

      {filas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-pand-border p-6 text-center text-sm text-pand-gris">
          Todavía no definiste ninguno. Al importar, las columnas que Pand no
          reconoce quedan en «no importar».
        </p>
      ) : (
        <div className="space-y-3">
          {filas.map((fila, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor={`campo-${i}`}>Nombre</Label>
                <Input
                  id={`campo-${i}`}
                  value={fila.label}
                  placeholder="Sucursal"
                  maxLength={60}
                  onChange={(e) => cambiar(i, { label: e.target.value })}
                />
              </div>

              <div className="w-40">
                <Label htmlFor={`tipo-${i}`}>Tipo</Label>
                <NativeSelect
                  id={`tipo-${i}`}
                  value={fila.tipo}
                  onChange={(e) => cambiar(i, { tipo: e.target.value as TipoDeCampo })}
                >
                  {TIPOS_DE_CAMPO.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {/* Que se importa y que ve el operador son dos cosas distintas.
                  Una planilla real trae 44 columnas: el numero de recibo o la
                  referencia de transferencia sirven para conciliar, no para la
                  llamada, y en la ficha son ruido arriba del telefono. */}
              <label className="flex items-center gap-2 pb-2.5 text-sm text-pand-gris">
                <input
                  type="checkbox"
                  checked={fila.enFicha}
                  onChange={(e) => cambiar(i, { enFicha: e.target.checked })}
                  className="h-4 w-4 rounded border-pand-border"
                />
                En el panel
              </label>

              <Button
                variant="ghost"
                size="icon"
                aria-label={`Quitar ${fila.label || "campo"}`}
                onClick={() => borrar(i)}
              >
                <Trash2 className="size-4 text-pand-coral" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {filas.length < MAX_CAMPOS_PROPIOS && (
        <Button variant="secondary" onClick={agregar}>
          <Plus className="size-4" />
          Agregar campo
        </Button>
      )}

      {borrados.length > 0 && (
        <p className="text-sm text-pand-gris">
          Vas a quitar {borrados.map((c) => `«${c.label}»`).join(", ")}. Lo ya
          importado no se borra: si volvés a crear el campo con el mismo nombre,
          los datos reaparecen.
        </p>
      )}

      <div className="flex justify-end border-t border-pand-border pt-4">
        <Button onClick={guardar} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          Guardar
        </Button>
      </div>
    </div>
  );
}
