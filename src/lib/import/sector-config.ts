import type { Sector } from "@/generated/prisma/enums";

/** Campos de Pand a los que se puede mapear una columna del archivo. */
export type FieldKey =
  | "externalId"
  | "name"
  | "documentNumber"
  | "email"
  | "phone"
  | "phoneAlt"
  | "invoiceNumber"
  | "amount"
  | "dueDate"
  | "description";

export type FieldType = "text" | "number" | "date";

export type FieldDef = {
  key: FieldKey;
  label: string;
  type: FieldType;
  required: boolean;
  hint?: string;
};

/**
 * El modelo de datos es el mismo para todos los sectores; lo que cambia es cómo le
 * dicen a cada cosa. Una financiera manda cuotas de préstamo y una distribuidora
 * manda facturas: son la misma fila de `invoices`, pero si la pantalla de mapeo dice
 * "Nro. de factura" a un analista de créditos, duda y mapea mal.
 *
 * Por eso esto son etiquetas por sector, no esquemas distintos.
 */
const BASE: FieldDef[] = [
  {
    key: "externalId",
    label: "ID del deudor",
    type: "text",
    required: true,
    hint: "La llave de tu sistema. Sobre esto se hace el upsert al reimportar.",
  },
  { key: "name", label: "Nombre del deudor", type: "text", required: true },
  { key: "documentNumber", label: "Documento", type: "text", required: false },
  { key: "email", label: "Email", type: "text", required: false },
  { key: "phone", label: "Teléfono", type: "text", required: false },
  { key: "phoneAlt", label: "Teléfono alternativo", type: "text", required: false },
  { key: "invoiceNumber", label: "Nro. de comprobante", type: "text", required: true },
  { key: "amount", label: "Monto", type: "number", required: true },
  { key: "dueDate", label: "Vencimiento", type: "date", required: true },
  { key: "description", label: "Descripción", type: "text", required: false },
];

const OVERRIDES: Record<Sector, Partial<Record<FieldKey, string>>> = {
  FINANCIAL: {
    externalId: "Nro. de cliente",
    documentNumber: "CI / RUC",
    invoiceNumber: "Nro. de préstamo o cuota",
    amount: "Monto de la cuota",
  },
  B2B: {
    externalId: "Código de cliente",
    name: "Razón social",
    documentNumber: "RUC",
    invoiceNumber: "Nro. de factura",
    amount: "Importe",
  },
  TELECOM: {
    externalId: "Nro. de cuenta",
    name: "Titular",
    documentNumber: "CI",
    invoiceNumber: "Nro. de línea o factura",
    amount: "Importe del período",
  },
  RETAIL: {
    externalId: "Nro. de cliente",
    name: "Nombre",
    documentNumber: "CI",
    invoiceNumber: "Nro. de boleta",
    amount: "Saldo",
  },
};

export function fieldsFor(sector: Sector): FieldDef[] {
  const overrides = OVERRIDES[sector];
  return BASE.map((field) => ({
    ...field,
    label: overrides[field.key] ?? field.label,
  }));
}

export const REQUIRED_FIELDS: FieldKey[] = BASE.filter((f) => f.required).map(
  (f) => f.key,
);

/**
 * Adivina a qué campo corresponde cada columna del archivo, para que el usuario
 * llegue al paso de mapeo con casi todo resuelto.
 *
 * Se compara sin acentos ni signos: "Razón Social", "razon_social" y "RAZON SOCIAL"
 * son la misma cosa, y todas aparecen en planillas reales.
 */
const ALIASES: Record<FieldKey, string[]> = {
  externalId: ["id", "idcliente", "codigo", "codigocliente", "nrocliente", "numerocliente", "cuenta", "nrocuenta", "externalid", "cliente"],
  name: ["nombre", "razonsocial", "titular", "deudor", "nombredeudor", "cliente", "nombrecompleto"],
  documentNumber: ["documento", "ci", "ruc", "cedula", "dni", "cuit", "nrodocumento", "documentnumber"],
  email: ["email", "correo", "mail", "correoelectronico"],
  phone: ["telefono", "tel", "celular", "movil", "phone", "contacto"],
  phoneAlt: ["telefono2", "telalternativo", "telefonoalternativo", "celular2", "otrotelefono"],
  invoiceNumber: ["factura", "nrofactura", "numerofactura", "comprobante", "nrocomprobante", "boleta", "prestamo", "cuota", "nroprestamo", "invoice"],
  amount: ["monto", "importe", "saldo", "deuda", "total", "montocuota", "amount", "valor"],
  dueDate: ["vencimiento", "fechavencimiento", "fechavto", "vto", "duedate", "fecha"],
  description: ["descripcion", "detalle", "concepto", "observacion", "description"],
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Devuelve el mapeo sugerido: columna del archivo → campo de Pand.
 *
 * Un campo no se sugiere dos veces: si dos columnas matchean lo mismo, gana la
 * primera y la segunda queda sin asignar para que el usuario decida. Autocompletar
 * las dos y pisar una sería peor que no sugerir nada.
 */
export function suggestMapping(
  headers: string[],
): Partial<Record<FieldKey, string>> {
  const mapping: Partial<Record<FieldKey, string>> = {};
  const used = new Set<string>();

  for (const [key, aliases] of Object.entries(ALIASES) as [FieldKey, string[]][]) {
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      const normalized = normalize(header);
      return aliases.some(
        (alias) => normalized === alias || normalized.startsWith(alias),
      );
    });

    if (match) {
      mapping[key] = match;
      used.add(match);
    }
  }

  return mapping;
}
