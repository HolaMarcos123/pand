"use client";

import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCurrency } from "@/lib/format";
import type { Tranche } from "@/lib/queries/dashboard";

/**
 * Cartera abierta por tramo de mora.
 *
 * Regla del manual: las barras van en gris neutro y el celeste se reserva para la
 * serie que se está analizando. Acá esa serie es el tramo +90, que es el indicador
 * crítico del negocio. Pintar todo de colores mataría la señal.
 */
export function TrancheChart({
  data,
  currency,
  writtenOff,
}: {
  data: Tranche[];
  currency: string;
  /** Cartera castigada: se informa al pie, fuera del gráfico. */
  writtenOff: number;
}) {
  const isEmpty = data.every((item) => item.amount === 0);

  if (isEmpty) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-card border border-pand-border bg-white">
        <p className="text-sm text-pand-gris">
          Sin cartera cargada todavía. Los tramos aparecen al importar la primera.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-card bg-white p-5 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
          Cartera activa por tramo
        </p>
        {writtenOff > 0 && (
          <p className="text-xs text-pand-gris">
            Castigado, fuera de la cartera activa:{" "}
            <span className="mono text-pand-coral">
              {formatCurrency(writtenOff, currency)}
            </span>
          </p>
        )}
      </div>

      <div className="mt-4 h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{
                fill: "#6E6E78",
                fontSize: 12,
                fontFamily: "JetBrains Mono, monospace",
              }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tick={{
                fill: "#6E6E78",
                fontSize: 11,
                fontFamily: "JetBrains Mono, monospace",
              }}
              // Notación compacta: los guaraníes llegan a nueve dígitos y romperían
              // el eje.
              tickFormatter={(value: number) =>
                new Intl.NumberFormat("es-PY", { notation: "compact" }).format(value)
              }
            />
            <Tooltip
              cursor={{ fill: "#F6F8FB" }}
              formatter={(value) => formatCurrency(Number(value), currency)}
              labelFormatter={(label) => `Tramo ${label}`}
              contentStyle={{
                borderRadius: 12,
                border: "1px solid #E6E9EE",
                fontFamily: "Manrope, sans-serif",
                fontSize: 13,
              }}
            />
            <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
              {/* Una sola serie destacada, como pide el manual: el peor tramo
                  activo. El resto en gris para que el celeste signifique algo. */}
              {data.map((item) => (
                <Cell
                  key={item.key}
                  fill={item.key === "LEGAL" ? "#7BE1FF" : "#E6E9EE"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
