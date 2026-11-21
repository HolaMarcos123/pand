import { matchHeaders } from "@/lib/import/normalize-header";
import type { Sector } from "@/generated/prisma/enums";

/** Campos de Pand a los que se puede mapear una columna del archivo. */
export type FieldKey =
  | "externalId"
  | "name"
  | "documentNumber"
  | "email"
  | "phone"
  | "phoneAlt"
  | "loanNumber"
  | "invoiceNumber"
  | "product"
  | "amount"
  | "dueDate"
  | "currency"
  | "description"
  | "referenceName"
  | "referencePhone"
  | "referenceRelation";

export type FieldType = "text" | "number" | "date" | "currency";

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
  {
    key: "loanNumber",
    label: "Nro. de operación",
    type: "text",
    required: false,
    hint: "El crédito al que pertenece la cuota. Mapealo si un mismo deudor puede tener más de una operación: sin esto, la cuota 1/60 de un crédito y la de otro no se distinguen.",
  },
  { key: "invoiceNumber", label: "Nro. de comprobante", type: "text", required: true },
  {
    key: "product",
    label: "Producto",
    type: "text",
    required: false,
    hint: "Qué se vendió o prestó. Se filtra y se reporta por acá, así que conviene que venga parejo y no como texto libre.",
  },
  { key: "amount", label: "Monto", type: "number", required: true },
  { key: "dueDate", label: "Vencimiento", type: "date", required: true },
  {
    key: "currency",
    label: "Moneda",
    type: "currency",
    required: false,
    hint: "Si la planilla mezcla guaraníes y dólares, mapeá esta columna. Sin ella, todo entra en la moneda de la organización — y una deuda en dólares guardada como guaraníes queda 7.000 veces más chica.",
  },
  { key: "description", label: "Descripción", type: "text", required: false },
  {
    key: "referenceName",
    label: "Referencia: nombre",
    type: "text",
    required: false,
    hint: "A quién llamar cuando el deudor no atiende. Si la planilla trae varias, mapeá la primera: el resto se cargan desde la ficha.",
  },
  { key: "referencePhone", label: "Referencia: teléfono", type: "text", required: false },
  {
    key: "referenceRelation",
    label: "Referencia: vínculo",
    type: "text",
    required: false,
    hint: "Hermano, cónyuge, garante.",
  },
];

const OVERRIDES: Record<Sector, Partial<Record<FieldKey, string>>> = {
  FINANCIAL: {
    externalId: "Nro. de cliente",
    documentNumber: "CI / RUC",
    loanNumber: "Nro. de operación o préstamo",
    invoiceNumber: "Nro. de cuota",
    product: "Línea de crédito",
    amount: "Monto de la cuota",
  },
  B2B: {
    externalId: "Código de cliente",
    name: "Razón social",
    documentNumber: "RUC",
    invoiceNumber: "Nro. de factura",
    product: "Producto o servicio",
    amount: "Importe",
  },
  TELECOM: {
    externalId: "Nro. de cuenta",
    name: "Titular",
    documentNumber: "CI",
    invoiceNumber: "Nro. de línea o factura",
    product: "Plan",
    amount: "Importe del período",
  },
  RETAIL: {
    externalId: "Nro. de cliente",
    name: "Nombre",
    documentNumber: "CI",
    invoiceNumber: "Nro. de boleta",
    product: "Artículo",
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
  loanNumber: ["operacion", "nrooperacion", "prestamo", "nroprestamo", "credito", "nrocredito", "contrato", "nrocontrato", "solicitud", "nrosolicitud"],
  invoiceNumber: ["nrocuo", "cuota", "nrocuota", "numerocuota", "factura", "nrofactura", "numerofactura", "comprobante", "nrocomprobante", "boleta", "invoice"],
  product: ["producto", "articulo", "item", "bien", "linea", "lineacredito", "plan", "servicio", "tipoproducto", "product"],
  amount: ["monto", "importe", "saldo", "deuda", "total", "montocuota", "amount", "valor"],
  dueDate: ["vencimiento", "fechavencimiento", "fechavto", "vto", "duedate", "fecha"],
  currency: ["moneda", "divisa", "currency", "mon", "tipomoneda", "monedacredito"],
  description: ["descripcion", "detalle", "concepto", "observacion", "description"],
  referenceName: ["referencia", "nombrereferencia", "referencianombre", "contactoreferencia", "garante", "nombregarante"],
  referencePhone: ["telefonoreferencia", "referenciatelefono", "telreferencia", "telefonogarante", "celularreferencia"],
  referenceRelation: ["vinculo", "parentesco", "relacion", "vinculoreferencia"],
};

export function suggestMapping(
  headers: string[],
): Partial<Record<FieldKey, string>> {
  return matchHeaders(headers, ALIASES);
}
