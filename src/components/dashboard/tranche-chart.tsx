"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ETIQUETA_DATO,
  EJE_CATEGORIA,
  EJE_VALOR,
  GRILLA,
  LIENZO,
  RAMPA_MORA,
  TINTA,
  TooltipVisual,
  VisualCard,
  compacto,
} from "@/components/dashboard/chart-primitives";
import { formatCurrency, formatPercent, safePercent } from "@/lib/format";
import type { Tranche } from "@/lib/queries/dashboard";

/**
 * Cartera abierta por tramo de mora.
 *
 * Los tramos son una escala ordenada, así que van en una rampa de un solo tono
 * que se oscurece hacia la derecha (ver `RAMPA_MORA`): la forma del gráfico dice
 * "esto empeora" sin que haya que leer el eje. Antes iban en gris con el tramo
 * legal en celeste, que señalaba bien pero dejaba sin información los cuatro
 * tramos del medio —que son justamente los que todavía se pueden cobrar—.
 *
 * Y lleva la etiqueta del importe sobre cada barra, como un visual de Power BI:
 * el gerente que mira esta pantalla necesita el número, no una proporción.
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
  const total = data.reduce((suma, item) => suma + item.amount, 0);

  if (total === 0) {
    return (
      <VisualCard
        titulo="Cartera activa por tramo de mora"
        subtitulo="Saldo abierto de los comprobantes, sin la cartera castigada"
      >
        <div className="flex h-[240px] items-center justify-center px-3">
          <p className="max-w-xs text-center text-sm text-pand-gris">
            Sin cartera cargada todavía. Los tramos aparecen al importar la primera.
          </p>
        </div>
      </VisualCard>
    );
  }

  // El peor tramo con plata adentro. Se nombra en el subtítulo porque es la
  // lectura que alguien busca en este gráfico: cuánto hay en lo más viejo.
  const peor = [...data].reverse().find((item) => item.amount > 0);

  return (
    <VisualCard
      titulo="Cartera activa por tramo de mora"
      subtitulo={
        <>
          Total abierto{" "}
          <span className="mono font-semibold text-pand-contorno">
            {formatCurrency(total, currency)}
          </span>
          {peor && (
            <>
              {" · "}
              {peor.label}{" "}
              <span className="mono font-semibold text-pand-contorno">
                {formatPercent(safePercent(peor.amount, total))}
              </span>
            </>
          )}
        </>
      }
      accion={
        writtenOff > 0 && (
          <p className="text-right text-xs text-pand-gris">
            Castigado, fuera de esta cartera
            <br />
            <span className="mono font-semibold text-pand-coral">
              {formatCurrency(writtenOff, currency)}
            </span>
          </p>
        )
      }
    >
      <div className={`h-[260px] ${LIENZO}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRILLA} />

            <XAxis dataKey="label" {...EJE_CATEGORIA} />
            <YAxis {...EJE_VALOR} tickFormatter={compacto} />

            <Tooltip
              cursor={{ fill: TINTA.cursor }}
              content={
                <TooltipVisual
                  prefijoEtiqueta="Tramo"
                  formatoValor={(valor) => formatCurrency(valor, currency)}
                />
              }
            />

            <Bar
              dataKey="amount"
              name="Saldo abierto"
              // Casi cuadrada, como una columna de Power BI: el radio grande
              // adelgaza la punta y corre la lectura del alto hacia abajo.
              radius={[2, 2, 0, 0]}
              maxBarSize={72}
            >
              {data.map((item) => (
                <Cell key={item.key} fill={RAMPA_MORA[item.key] ?? TINTA.eje} />
              ))}

              {/* El importe arriba de la barra. Compacto y no completo: en
                  guaraníes el número entero se superpone con el de al lado. */}
              <LabelList
                dataKey="amount"
                {...ETIQUETA_DATO}
                formatter={(valor: unknown) =>
                  Number(valor) > 0 ? compacto(Number(valor)) : ""
                }
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </VisualCard>
  );
}
