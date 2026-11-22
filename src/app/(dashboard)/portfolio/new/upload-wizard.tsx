"use client";

import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  History,
  Info,
  Loader2,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { agregarCampoPropio } from "@/lib/config/actions";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  createPortfolio,
  finalizePortfolio,
  importBatch,
  saveColumnMapping,
} from "@/lib/import/actions";
import { etiquetaDesdeEncabezado, tipoDesdeMuestra } from "@/lib/import/campo-nuevo";
import { readSpreadsheet, type SheetData } from "@/lib/import/read-file";
import { BATCH_SIZE } from "@/lib/import/row-schema";
import {
  PREFIJO_PROPIO,
  depurarMapeoGuardado,
  fieldsFor,
  suggestMapping,
  type MapeoDepurado,
  type MappableKey,
} from "@/lib/import/sector-config";
import {
  errorsToCsv,
  validateRows,
  type Aviso,
} from "@/lib/import/validate-rows";
import {
  MAX_CAMPOS_PROPIOS,
  TIPOS_DE_CAMPO,
  idDeCampo,
  type CampoPropio,
  type TipoDeCampo,
} from "@/lib/config/settings";
import type { Sector } from "@/generated/prisma/enums";

const STEPS = ["Archivo", "Mapeo", "Confirmar"] as const;

/** Valor centinela del desplegable: no es un campo, abre el diálogo. */
const NUEVO_CAMPO = "__nuevo__";

// La clave es un campo de Pand o uno propio de la organizacion
// ("custom:<id>"), de ahi que sea string y no la union de campos fijos.
type Mapping = Partial<Record<MappableKey, string>>;

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
  camposPropios,
  savedMappings,
}: {
  defaultSector: Sector;
  currency: string;
  /** Las columnas propias de la organizacion, definidas en Config. */
  camposPropios: CampoPropio[];
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

  // Los campos propios se editan desde acá, así que son estado y no solo la
  // prop: al crear uno tiene que aparecer en el desplegable sin recargar.
  /**
   * Lo que adivinamos para este archivo, guardado aparte del mapeo en uso.
   * Es lo que permite volver atras despues de aplicar un mapeo guardado.
   */
  const [sugerencia, setSugerencia] = useState<Mapping>({});
  const [guardadoAplicado, setGuardadoAplicado] = useState<{
    descartados: MapeoDepurado["descartados"];
  } | null>(null);

  const [campos, setCampos] = useState<CampoPropio[]>(camposPropios);
  const [borrador, setBorrador] = useState<{
    header: string;
    label: string;
    tipo: TipoDeCampo;
  } | null>(null);
  const [creando, setCreando] = useState(false);

  const fields = useMemo(() => fieldsFor(sector, campos), [sector, campos]);

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
  function asignarColumna(header: string, campo: MappableKey | null) {
    setMapping((actual) => {
      const siguiente: Mapping = { ...actual };

      for (const clave of Object.keys(siguiente)) {
        if (siguiente[clave] === header) delete siguiente[clave];
      }

      if (campo) siguiente[campo] = header;
      return siguiente;
    });
  }

  /** Abre el diálogo con el nombre y el tipo ya adivinados desde la columna. */
  function proponerCampo(header: string) {
    if (!sheet) return;

    if (campos.length >= MAX_CAMPOS_PROPIOS) {
      toast.error(
        `Llegaste a los ${MAX_CAMPOS_PROPIOS} campos propios. Borrá alguno en Config → Campos propios.`,
      );
      return;
    }

    setBorrador({
      header,
      label: etiquetaDesdeEncabezado(header),
      tipo: tipoDesdeMuestra(sheet.rows.slice(0, 30).map((row) => row[header])),
    });
  }

  /**
   * Crea el campo propio y le asigna la columna en el acto.
   *
   * Se guarda en la configuración de la organización —no es algo de esta carga—
   * para que la próxima planilla con la misma columna ya lo encuentre hecho.
   */
  async function crearCampo() {
    if (!borrador) return;

    const label = borrador.label.trim();
    if (label.length === 0) {
      toast.error("Ponele un nombre al campo.");
      return;
    }

    const repetido = campos.find((c) => c.id === idDeCampo(label));
    if (repetido) {
      toast.error(`Ya existe un campo propio «${repetido.label}». Elegilo de la lista.`);
      return;
    }

    setCreando(true);
    try {
      // Solo agrega: el servidor resuelve el id y vuelve a chequear el duplicado
      // contra la base, por si alguien creó el mismo campo mientras tanto.
      const outcome = await agregarCampoPropio({ label, tipo: borrador.tipo });
      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }

      setCampos((actuales) => [...actuales, outcome.campo]);
      asignarColumna(borrador.header, `${PREFIJO_PROPIO}${outcome.campo.id}`);
      setBorrador(null);
      toast.success(`«${label}» queda como campo propio y se importa con esta carga.`);
    } finally {
      setCreando(false);
    }
  }

  async function handleFile(file: File) {
    setReading(true);
    try {
      const data = await readSpreadsheet(file);
      setSheet(data);

      // Con las filas: el adivinador mira el dato y no solo el encabezado.
      const suggested = suggestMapping(data.headers, data.rows);
      setSugerencia(suggested);

      // El mapeo guardado de este sector pisa la sugerencia, pero antes pasa
      // por el mismo filtro: uno que quedo mal se reaplica para siempre y en
      // silencio, y eso es justo lo que no se puede ver desde la pantalla.
      const saved = savedMappings[sector];
      const depurado = saved
        ? depurarMapeoGuardado(saved, data.headers, data.rows)
        : null;

      setMapping({ ...suggested, ...(depurado?.mapeo ?? {}) });
      setGuardadoAplicado(
        depurado && Object.keys(depurado.mapeo).length > 0
          ? { descartados: depurado.descartados }
          : null,
      );
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

          {guardadoAplicado && (
            <div className="rounded-xl border border-pand-border bg-pand-bg p-4">
              <div className="flex items-start gap-3">
                <History className="mt-0.5 h-5 w-5 shrink-0 text-pand-azul" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-pand-contorno">
                    Estás usando un mapeo guardado
                  </p>
                  <p className="mt-1 text-xs text-pand-gris">
                    Viene de una carga anterior de este sector, no de lo que
                    adivinamos para este archivo.
                  </p>

                  {guardadoAplicado.descartados.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {guardadoAplicado.descartados.map((d) => (
                        <li key={d.campo} className="text-xs text-pand-gris">
                          Descartamos{" "}
                          <strong className="font-semibold text-pand-contorno">
                            {fields.find((f) => f.key === d.campo)?.label ?? d.campo}
                          </strong>{" "}
                          → <span className="mono">{d.columna}</span>: esa columna{" "}
                          {d.motivo}.
                        </li>
                      ))}
                    </ul>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMapping(sugerencia);
                      setGuardadoAplicado(null);
                      setRememberMapping(false);
                      toast.success("Volvimos a lo que adivinamos para este archivo.");
                    }}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-pand-azul hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Volver a la sugerencia
                  </button>
                </div>
              </div>
            </div>
          )}

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
                          onChange={(event) => {
                            const elegido = event.target.value;
                            // El centinela no es un campo: abre el diálogo y
                            // deja el mapeo como estaba hasta que se cree.
                            if (elegido === NUEVO_CAMPO) {
                              proponerCampo(header);
                              return;
                            }
                            asignarColumna(header, elegido || null);
                          }}
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
                          {/* La salida para lo que Pand no modela: sucursal,
                              auxiliar de cobranza, el nro. de factura del ERP.
                              Sin esto hay que abandonar la carga, ir a Config a
                              declarar el campo y volver a subir el archivo. */}
                          <option value={NUEVO_CAMPO}>
                            + Guardar como campo propio…
                          </option>
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

          {validation && <Avisos avisos={validation.avisos} />}

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

          <Avisos avisos={validation.avisos} />

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

      <Dialog
        open={borrador !== null}
        onOpenChange={(abierto) => {
          if (!abierto && !creando) setBorrador(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar como campo propio</DialogTitle>
            <DialogDescription>
              «{borrador?.header}» no es algo que Pand modele. Guardalo como campo
              propio y viaja con cada cuota, sin que Pand haga cuentas con él.
              Queda en la configuración, así que la próxima planilla con esta
              columna ya lo va a encontrar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="campo-nuevo-label">Nombre</Label>
              <Input
                id="campo-nuevo-label"
                value={borrador?.label ?? ""}
                maxLength={60}
                autoFocus
                onChange={(event) =>
                  setBorrador((actual) =>
                    actual ? { ...actual, label: event.target.value } : actual,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void crearCampo();
                  }
                }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="campo-nuevo-tipo">Tipo</Label>
              <NativeSelect
                id="campo-nuevo-tipo"
                value={borrador?.tipo ?? "texto"}
                onChange={(event) =>
                  setBorrador((actual) =>
                    actual
                      ? { ...actual, tipo: event.target.value as TipoDeCampo }
                      : actual,
                  )
                }
              >
                {TIPOS_DE_CAMPO.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </NativeSelect>
              {sheet && borrador && (
                <p className="text-xs text-pand-gris">
                  En tu archivo trae{" "}
                  <span className="mono">{muestraDe(sheet.rows, borrador.header)}</span>.
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setBorrador(null)}
              disabled={creando}
            >
              Cancelar
            </Button>
            <Button onClick={crearCampo} disabled={creando}>
              {creando && <Loader2 className="size-4 animate-spin" />}
              Crear y mapear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Los campos propios cuyo tipo no coincidió con el dato. No es un error: la
 * fila entra igual y el valor se guarda como texto. Se muestra para que la
 * persona pueda corregir el tipo en Config si le importa, no para frenarla.
 */
function Avisos({ avisos }: { avisos: Aviso[] }) {
  if (avisos.length === 0) return null;

  return (
    <div className="rounded-xl border border-pand-border bg-pand-bg p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-pand-azul" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-pand-contorno">
            Se guardan como texto
          </p>
          <ul className="mt-2 space-y-1">
            {avisos.map((aviso) => (
              <li key={aviso.field} className="text-xs text-pand-gris">
                <strong className="font-semibold text-pand-contorno">
                  {aviso.field}
                </strong>{" "}
                · {formatNumber(aviso.count)}{" "}
                {aviso.count === 1 ? "valor no entró" : "valores no entraron"} en
                el tipo elegido (ej. <span className="mono">{aviso.ejemplo}</span>
                ). Se importan igual, como texto.
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-pand-gris">
            Si el tipo quedó mal, cambialo en Config → Campos propios.
          </p>
        </div>
      </div>
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
