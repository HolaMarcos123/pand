"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Download, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SECTORS } from "@/lib/auth/schemas";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  createPortfolio,
  finalizePortfolio,
  importBatch,
  saveColumnMapping,
} from "@/lib/import/actions";
import { readSpreadsheet, type SheetData } from "@/lib/import/read-file";
import { BATCH_SIZE } from "@/lib/import/row-schema";
import { fieldsFor, suggestMapping, type FieldKey } from "@/lib/import/sector-config";
import { errorsToCsv, validateRows } from "@/lib/import/validate-rows";
import type { Sector } from "@/generated/prisma/enums";

const STEPS = ["Archivo", "Mapeo", "Confirmar"] as const;

type Mapping = Partial<Record<FieldKey, string>>;

/**
 * El primer valor no vacio de una columna, para mostrar que trae.
 *
 * Es el dato que convierte el mapeo en algo verificable de un vistazo: una
 * columna llamada "NRO CUO" que muestra "1.016.488,00" esta mal mapeada, y se ve
 * sin abrir el Excel. Se miran las primeras filas y no solo la primera porque la
 * primera puede venir vacia.
 */
function muestraDe(rows: Record<string, unknown>[], header: string): string {
  for (const row of rows.slice(0, 20)) {
    const valor = row[header];
    if (valor === null || valor === undefined) continue;
    const texto = String(valor).trim();
    if (!texto) continue;
    return texto.length > 28 ? `${texto.slice(0, 28)}…` : texto;
  }
  return "—";
}

export function UploadWizard({
  defaultSector,
  currency,
  savedMappings,
}: {
  defaultSector: Sector;
  currency: string;
  savedMappings: Record<string, Record<string, string>>;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [name, setName] = useState("");
  const [sector, setSector] = useState<Sector>(defaultSector);
  const [sheet, setSheet] = useState<SheetData | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [rememberMapping, setRememberMapping] = useState(true);

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const fields = useMemo(() => fieldsFor(sector), [sector]);

  // Se revalida en cada cambio de mapeo: el usuario ve el impacto al instante en vez
  // de descubrir 4.000 errores recién al final.
  const validation = useMemo(
    () => (sheet ? validateRows(sheet.rows, mapping, fields) : null),
    [sheet, mapping, fields],
  );

  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);

  /**
   * Asigna una columna del archivo a un campo de Pand.
   *
   * El estado se guarda como campo -> columna porque es lo que consume la
   * validacion, pero la pantalla pregunta al reves: por cada columna, que es.
   * De ahi que haya que sacar la columna de cualquier campo que la tuviera antes
   * de ponerla en el nuevo; si no, una columna podria quedar asignada a dos
   * campos y el ultimo mapeo ganaria sin que se vea en pantalla.
   */
  function asignarColumna(header: string, campo: FieldKey | null) {
    setMapping((actual) => {
      const siguiente: Mapping = { ...actual };

      for (const clave of Object.keys(siguiente) as FieldKey[]) {
        if (siguiente[clave] === header) delete siguiente[clave];
      }

      if (campo) siguiente[campo] = header;
      return siguiente;
    });
  }

  async function handleFile(file: File) {
    setReading(true);
    try {
      const data = await readSpreadsheet(file);
      setSheet(data);

      // Arranca del mapeo guardado para este sector si existe; si no, adivina por
      // el nombre de los encabezados.
      const saved = savedMappings[sector];
      const suggested = suggestMapping(data.headers);
      const base: Mapping = saved
        ? // Solo se conservan las columnas que este archivo realmente trae.
          Object.fromEntries(
            Object.entries(saved).filter(([, column]) =>
              data.headers.includes(column),
            ),
          )
        : {};

      setMapping({ ...suggested, ...base });
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""));
      toast.success(`${formatNumber(data.rows.length)} filas leídas.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    } finally {
      setReading(false);
    }
  }

  function downloadErrors() {
    if (!validation?.errors.length) return;
    const blob = new Blob([errorsToCsv(validation.errors)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "errores-importacion.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function process() {
    if (!validation?.valid.length) return;

    const created = await createPortfolio({ name, sector });
    if (!created.ok) {
      toast.error(created.error);
      return;
    }

    const rows = validation.valid;
    setProgress({ done: 0, total: rows.length });

    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = await importBatch({
          portfolioId: created.portfolioId,
          rows: batch,
        });

        if (!result.ok) {
          toast.error(result.error);
          setProgress(null);
          return;
        }

        setProgress({ done: Math.min(i + batch.length, rows.length), total: rows.length });
      }

      if (rememberMapping) {
        await saveColumnMapping({
          sector,
          mapping: mapping as Record<string, string>,
        });
      }

      const done = await finalizePortfolio(created.portfolioId);
      if (!done.ok) {
        toast.error(done.error);
        setProgress(null);
        return;
      }

      toast.success(
        `Cartera lista: ${formatNumber(done.totalClients)} deudores por ${formatCurrency(done.totalAmount, currency)}.`,
      );
      router.push("/portfolio");
      router.refresh();
    } catch {
      toast.error("Se cortó la importación. La cartera quedó a medio cargar.");
      setProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Stepper current={step} />

      {step === 0 && (
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div>
            <h2 className="text-xl font-bold">Subí el archivo</h2>
            <p className="mt-1 text-sm text-pand-gris">
              Un .xlsx o .csv con tus deudores. La primera fila tiene que ser la de
              encabezados.
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
            <p className="mt-1 text-xs text-pand-gris">
              .xlsx, .xlsb, .xls o .csv · hasta 70 MB
            </p>
            {/* El consejo importa: un .xlsx es XML comprimido y el navegador lo
                expande en memoria. Para una cartera grande, .xlsb o .csv pesan
                menos y se leen mucho más rápido. */}
            <p className="mt-1 text-xs text-pand-gris">
              Para archivos grandes conviene .xlsb o .csv
            </p>

            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xlsm,.xlsb,.xls,.csv,.tsv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="portfolio-name">Nombre de la cartera</Label>
              <Input
                id="portfolio-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Cartera agosto"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="portfolio-sector">Sector</Label>
              <NativeSelect
                id="portfolio-sector"
                value={sector}
                onChange={(event) => setSector(event.target.value as Sector)}
              >
                {SECTORS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {sheet && <PreviewTable sheet={sheet} rows={10} />}

          <div className="flex justify-end border-t border-pand-border pt-4">
            <Button
              onClick={() => setStep(1)}
              disabled={!sheet || name.trim().length < 2}
            >
              Continuar
            </Button>
          </div>
        </section>
      )}

      {step === 1 && sheet && (
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div>
            <h2 className="text-xl font-bold">Elegí qué subir</h2>
            <p className="mt-1 text-sm text-pand-gris">
              Están todas las columnas de tu archivo. Ya adivinamos lo que pudimos;
              decidí qué es cada una y dejá en «no importar» lo que no haga falta.
            </p>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Columna en tu archivo</TableHead>
                  {/* El ejemplo es lo que hace evidente un mapeo equivocado: una
                      columna de montos apuntando a «Nro. de cuota» se ve de
                      inmediato, y ese error ya costó una cartera entera. */}
                  <TableHead>Ejemplo</TableHead>
                  <TableHead>Qué es en Pand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sheet.headers.map((header) => {
                  const asignado = fields.find((f) => mapping[f.key] === header);

                  return (
                    <TableRow key={header}>
                      <TableCell>
                        <span className="font-semibold">{header}</span>
                        {asignado?.hint && (
                          <p className="mt-0.5 max-w-sm text-xs text-pand-gris">
                            {asignado.hint}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="mono text-xs text-pand-gris">
                          {muestraDe(sheet.rows, header)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <NativeSelect
                          value={asignado?.key ?? ""}
                          onChange={(event) =>
                            asignarColumna(header, (event.target.value || null) as FieldKey | null)
                          }
                        >
                          <option value="">— no importar —</option>
                          {fields.map((field) => {
                            // Un campo ya tomado por otra columna se muestra con
                            // la columna que lo tiene, para que se entienda por
                            // qué elegirlo acá se lo saca de allá.
                            const tomadoPor = mapping[field.key];
                            const ocupado = tomadoPor && tomadoPor !== header;

                            return (
                              <option key={field.key} value={field.key}>
                                {field.label}
                                {field.required ? " *" : ""}
                                {ocupado ? ` (hoy: ${tomadoPor})` : ""}
                              </option>
                            );
                          })}
                        </NativeSelect>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm text-pand-gris">
            Se van a importar{" "}
            <strong className="text-pand-tinta">
              {sheet.headers.filter((h) => fields.some((f) => mapping[f.key] === h)).length}
            </strong>{" "}
            de {sheet.headers.length} columnas.
          </p>

          {missingRequired.length > 0 && (
            <p className="text-sm text-pand-coral">
              Falta asignar: {missingRequired.map((f) => f.label).join(", ")}.
            </p>
          )}

          {validation && validation.valid.length > 0 && (
            <MappedPreview rows={validation.valid.slice(0, 3)} currency={currency} />
          )}

          <label className="flex items-center gap-2 text-sm text-pand-gris">
            <input
              type="checkbox"
              checked={rememberMapping}
              onChange={(event) => setRememberMapping(event.target.checked)}
              className="h-4 w-4 rounded border-pand-border"
            />
            Guardar este mapeo para las próximas cargas de este sector
          </label>

          <div className="flex justify-between border-t border-pand-border pt-4">
            <Button variant="outline" onClick={() => setStep(0)}>
              Atrás
            </Button>
            <Button onClick={() => setStep(2)} disabled={missingRequired.length > 0}>
              Continuar
            </Button>
          </div>
        </section>
      )}

      {step === 2 && validation && (
        <section className="space-y-5 rounded-card bg-white p-6 shadow-card">
          <div>
            <h2 className="text-xl font-bold">Confirmá la carga</h2>
            <p className="mt-1 text-sm text-pand-gris">
              Revisá el resumen antes de escribir en tu cartera.
            </p>
          </div>

          <dl className="grid gap-4 sm:grid-cols-3">
            <Summary label="Filas a importar" value={formatNumber(validation.valid.length)} />
            <Summary
              label="Campos mapeados"
              value={formatNumber(Object.values(mapping).filter(Boolean).length)}
            />
            <Summary
              label="Filas con error"
              value={formatNumber(validation.errors.length)}
              alert={validation.errors.length > 0}
            />
          </dl>

          {validation.errors.length > 0 && (
            <div className="rounded-xl border border-pand-border bg-pand-bg p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-pand-coral" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-pand-contorno">
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
                  {validation.errors.length > 5 && (
                    <p className="mt-1 text-xs text-pand-gris">
                      y {formatNumber(validation.errors.length - 5)} más.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={downloadErrors}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-pand-azul hover:underline"
                  >
                    <Download className="h-3 w-3" />
                    Descargar el detalle
                  </button>
                </div>
              </div>
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
                {formatNumber(progress.done)} / {formatNumber(progress.total)} filas
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
                  Procesando…
                </>
              ) : (
                "Procesar cartera"
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
            <span
              className={
                active ? "text-sm font-semibold" : "text-sm text-pand-gris"
              }
            >
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

function PreviewTable({ sheet, rows }: { sheet: SheetData; rows: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-pand-border">
      <Table>
        <TableHeader>
          <TableRow>
            {sheet.headers.map((header) => (
              <TableHead key={header} className="whitespace-nowrap">
                {header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sheet.rows.slice(0, rows).map((row, index) => (
            <TableRow key={index}>
              {sheet.headers.map((header) => (
                <TableCell key={header} className="whitespace-nowrap text-xs">
                  {row[header] === null || row[header] === undefined
                    ? ""
                    : String(row[header])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Tres filas ya interpretadas: es donde se ve si el mapeo quedó bien. */
function MappedPreview({
  rows,
  currency,
}: {
  rows: { name: string; invoiceNumber: string; amount: number; dueDate: string }[];
  currency: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-pand-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Deudor</TableHead>
            <TableHead>Comprobante</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead>Vence</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={index}>
              <TableCell className="font-semibold">{row.name}</TableCell>
              <TableCell className="mono text-xs">{row.invoiceNumber}</TableCell>
              <TableCell className="mono text-right">
                {formatCurrency(row.amount, currency)}
              </TableCell>
              <TableCell className="mono text-xs">{row.dueDate}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
