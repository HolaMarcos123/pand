"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  importPaymentBatch,
  type PaymentOutcome,
} from "@/lib/import/payment-actions";
import {
  PAYMENT_FIELDS,
  suggestPaymentMapping,
  type PaymentFieldKey,
} from "@/lib/import/payment-config";
import { readSpreadsheet, type SheetData } from "@/lib/import/read-file";
import { errorsToCsv } from "@/lib/import/validate-rows";
import {
  PAYMENT_BATCH_SIZE,
  validatePaymentRows,
} from "@/lib/import/validate-payments";

const STEPS = ["Archivo", "Mapeo", "Confirmar"] as const;

type Mapping = Partial<Record<PaymentFieldKey, string>>;

type Totals = {
  applied: number;
  duplicated: number;
  allocated: number;
  unallocated: number;
  problems: PaymentOutcome[];
};

export function PaymentsWizard({ currency }: { currency: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<Totals | null>(null);

  const validation = useMemo(
    () => (sheet ? validatePaymentRows(sheet.rows, mapping) : null),
    [sheet, mapping],
  );

  const hasMatchKey = Boolean(mapping.matchExternalId || mapping.matchDocument);
  const missing = PAYMENT_FIELDS.filter((f) => f.required && !mapping[f.key]);
  const canContinue = hasMatchKey && missing.length === 0;

  async function handleFile(file: File) {
    setReading(true);
    try {
      const data = await readSpreadsheet(file);
      setSheet(data);
      setMapping(suggestPaymentMapping(data.headers));
      toast.success(`${formatNumber(data.rows.length)} filas leídas.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo leer el archivo.",
      );
    } finally {
      setReading(false);
    }
  }

  function downloadProblems() {
    if (!result?.problems.length) return;
    const csv = errorsToCsv(
      result.problems.map((p) => ({
        row: p.row,
        field: p.status,
        message: p.detail,
      })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cobros-con-problemas.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function process() {
    if (!validation?.valid.length) return;

    const rows = validation.valid;
    setProgress({ done: 0, total: rows.length });

    const totals: Totals = {
      applied: 0,
      duplicated: 0,
      allocated: 0,
      unallocated: 0,
      problems: [],
    };

    try {
      for (let i = 0; i < rows.length; i += PAYMENT_BATCH_SIZE) {
        const batch = rows.slice(i, i + PAYMENT_BATCH_SIZE);
        const outcome = await importPaymentBatch({ rows: batch });

        if (!outcome.ok) {
          toast.error(outcome.error);
          setProgress(null);
          return;
        }

        totals.applied += outcome.applied;
        totals.duplicated += outcome.duplicated;
        totals.allocated += outcome.allocated;
        totals.unallocated += outcome.unallocated;
        totals.problems.push(...outcome.problems);

        setProgress({
          done: Math.min(i + batch.length, rows.length),
          total: rows.length,
        });
      }

      setResult(totals);
      setProgress(null);
      toast.success(
        `${formatNumber(totals.applied)} cobros aplicados por ${formatCurrency(totals.allocated, currency)}.`,
      );
      router.refresh();
    } catch {
      toast.error("Se cortó la importación de cobros.");
      setProgress(null);
    }
  }

  // ── Pantalla de resultado ───────────────────────────────────
  if (result) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-pand-celeste">
              <Check className="h-5 w-5 text-pand-contorno" />
            </span>
            <div>
              <h2 className="text-xl font-bold">Cobros importados</h2>
              <p className="mt-1 text-sm text-pand-gris">
                Las facturas y la deuda de cada cliente ya quedaron actualizadas.
              </p>
            </div>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <Summary
              label="Cobros aplicados"
              value={formatNumber(result.applied)}
            />
            <Summary
              label="Plata imputada"
              value={formatCurrency(result.allocated, currency)}
            />
            <Summary
              label="Duplicados salteados"
              value={formatNumber(result.duplicated)}
              alert={result.duplicated > 0}
            />
            <Summary
              label="Sin imputar"
              value={formatCurrency(result.unallocated, currency)}
              alert={result.unallocated > 0}
            />
          </dl>

          {result.problems.length > 0 && (
            <ProblemList problems={result.problems} onDownload={downloadProblems} />
          )}

          <div className="flex gap-3 border-t border-pand-border pt-4">
            <Button asChild variant="outline" className="flex-1">
              <Link href="/portfolio">Ver carteras</Link>
            </Button>
            <Button asChild className="flex-1">
              <Link href="/overview">Ir al dashboard</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Stepper current={step} />

      {step === 0 && (
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div>
            <h2 className="text-xl font-bold">Subí la planilla de cobros</h2>
            <p className="mt-1 text-sm text-pand-gris">
              Cada fila es un cobro. Se imputa contra los comprobantes abiertos del
              deudor, del más viejo al más nuevo.
            </p>
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void handleFile(file);
            }}
            onClick={() => fileInput.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
              dragging
                ? "border-pand-celeste bg-pand-bg"
                : "border-pand-border bg-white hover:border-pand-celeste hover:bg-pand-bg"
            }`}
          >
            {reading ? (
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-pand-azul" />
            ) : sheet ? (
              <FileSpreadsheet className="mx-auto h-8 w-8 text-pand-azul" />
            ) : (
              <Upload className="mx-auto h-8 w-8 text-pand-gris" />
            )}

            <p className="mt-3 text-sm font-semibold">
              {sheet
                ? `${formatNumber(sheet.rows.length)} filas · ${sheet.headers.length} columnas`
                : "Arrastrá el archivo o hacé clic para elegirlo"}
            </p>
            <p className="mt-1 text-xs text-pand-gris">.xlsx o .csv · hasta 15 MB</p>

            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv,.tsv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="flex justify-end border-t border-pand-border pt-4">
            <Button onClick={() => setStep(1)} disabled={!sheet}>
              Continuar
            </Button>
          </div>
        </section>
      )}

      {step === 1 && sheet && (
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div>
            <h2 className="text-xl font-bold">Emparejá las columnas</h2>
            <p className="mt-1 text-sm text-pand-gris">
              Hace falta al menos una forma de identificar al deudor: el ID o el
              documento.
            </p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campo de Pand</TableHead>
                  <TableHead>Columna en tu archivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PAYMENT_FIELDS.map((field) => (
                  <TableRow key={field.key}>
                    <TableCell>
                      <span className="font-semibold">{field.label}</span>
                      {field.required && (
                        <span className="ml-1 text-pand-coral">*</span>
                      )}
                      {field.hint && (
                        <p className="mt-0.5 text-xs text-pand-gris">{field.hint}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <NativeSelect
                        value={mapping[field.key] ?? ""}
                        onChange={(event) =>
                          setMapping((current) => ({
                            ...current,
                            [field.key]: event.target.value || undefined,
                          }))
                        }
                      >
                        <option value="">— sin asignar —</option>
                        {sheet.headers.map((header) => (
                          <option key={header} value={header}>
                            {header}
                          </option>
                        ))}
                      </NativeSelect>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {!hasMatchKey && (
            <p className="text-sm text-pand-coral">
              Asigná el ID o el documento del deudor: sin eso no se sabe a quién
              imputar el cobro.
            </p>
          )}

          {missing.length > 0 && (
            <p className="text-sm text-pand-coral">
              Falta asignar: {missing.map((f) => f.label).join(", ")}.
            </p>
          )}

          {/* La referencia no es obligatoria, pero sin ella no hay red contra la
              doble carga. Vale avisarlo antes y no después de duplicar la plata. */}
          {canContinue && !mapping.reference && (
            <div className="flex items-start gap-3 rounded-xl border border-pand-border bg-pand-bg p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-pand-coral" />
              <p className="text-sm text-pand-gris">
                No mapeaste la referencia. Se puede importar igual, pero{" "}
                <strong className="text-pand-contorno">
                  no vamos a poder detectar si estos cobros ya fueron cargados
                </strong>
                : subir el archivo dos veces duplicaría la plata cobrada.
              </p>
            </div>
          )}

          <div className="flex justify-between border-t border-pand-border pt-4">
            <Button variant="outline" onClick={() => setStep(0)}>
              Atrás
            </Button>
            <Button onClick={() => setStep(2)} disabled={!canContinue}>
              Continuar
            </Button>
          </div>
        </section>
      )}

      {step === 2 && validation && (
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div>
            <h2 className="text-xl font-bold">Confirmá los cobros</h2>
            <p className="mt-1 text-sm text-pand-gris">
              Esto baja deuda y puede marcar comprobantes como pagados.
            </p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-3">
            <Summary
              label="Cobros a aplicar"
              value={formatNumber(validation.valid.length)}
            />
            <Summary
              label="Total del archivo"
              value={formatCurrency(
                validation.valid.reduce((sum, row) => sum + row.amount, 0),
                currency,
              )}
            />
            <Summary
              label="Filas con error"
              value={formatNumber(validation.errors.length)}
              alert={validation.errors.length > 0}
            />
          </dl>

          {validation.errors.length > 0 && (
            <div className="rounded-xl border border-pand-border bg-pand-bg p-4">
              <p className="text-sm font-semibold">
                {formatNumber(validation.errors.length)} filas se van a saltear
              </p>
              <ul className="mt-2 space-y-1">
                {validation.errors.slice(0, 5).map((error, index) => (
                  <li key={index} className="text-xs text-pand-coral">
                    <span className="mono">Fila {error.row}</span> · {error.field}:{" "}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {progress && (
            <div className="space-y-2">
              <div className="h-2 overflow-hidden rounded-full bg-pand-border">
                <div
                  className="h-full bg-pand-celeste transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <p className="mono text-xs text-pand-gris">
                {formatNumber(progress.done)} / {formatNumber(progress.total)} cobros
              </p>
            </div>
          )}

          <div className="flex justify-between border-t border-pand-border pt-4">
            <Button variant="outline" onClick={() => setStep(1)} disabled={!!progress}>
              Atrás
            </Button>
            <Button
              onClick={process}
              disabled={!!progress || validation.valid.length === 0}
            >
              {progress ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aplicando…
                </>
              ) : (
                "Aplicar cobros"
              )}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;

        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={[
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                done && "bg-pand-azul text-white",
                active && "bg-pand-celeste text-pand-contorno",
                !done && !active && "bg-pand-border text-pand-gris",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {done ? <Check className="h-4 w-4" /> : index + 1}
            </span>
            <span className={active ? "text-sm font-semibold" : "text-sm text-pand-gris"}>
              {label}
            </span>
            {index < STEPS.length - 1 && (
              <span className="ml-1 hidden h-px flex-1 bg-pand-border sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Summary({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="rounded-xl border border-pand-border p-4">
      <dt className="text-xs font-semibold uppercase tracking-wider text-pand-gris">
        {label}
      </dt>
      <dd
        className={`mono mt-2 text-2xl font-medium ${
          alert ? "text-pand-coral" : "text-pand-contorno"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

const PROBLEM_LABELS: Record<PaymentOutcome["status"], string> = {
  duplicated: "Ya estaba cargado",
  not_found: "Deudor no encontrado",
  ambiguous: "Documento ambiguo",
  unapplied: "Sin imputar",
};

function ProblemList({
  problems,
  onDownload,
}: {
  problems: PaymentOutcome[];
  onDownload: () => void;
}) {
  return (
    <div className="rounded-xl border border-pand-border bg-pand-bg p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-pand-coral" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {formatNumber(problems.length)} filas necesitan tu atención
          </p>
          <ul className="mt-2 space-y-1">
            {problems.slice(0, 6).map((problem, index) => (
              <li key={index} className="text-xs text-pand-gris">
                <span className="mono">Fila {problem.row}</span> ·{" "}
                <span className="font-semibold text-pand-coral">
                  {PROBLEM_LABELS[problem.status]}
                </span>
                : {problem.detail}
              </li>
            ))}
          </ul>
          {problems.length > 6 && (
            <p className="mt-1 text-xs text-pand-gris">
              y {formatNumber(problems.length - 6)} más.
            </p>
          )}
          <button
            type="button"
            onClick={onDownload}
            className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-pand-azul hover:underline"
          >
            <Download className="h-3 w-3" />
            Descargar el detalle
          </button>
        </div>
      </div>
    </div>
  );
}
