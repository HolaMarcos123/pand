import { matchHeaders, normalizeHeader } from "@/lib/import/normalize-header";
import type { PaymentMethod } from "@/generated/prisma/enums";

export type PaymentFieldKey =
  | "matchExternalId"
  | "matchDocument"
  | "invoiceNumber"
  | "amount"
  | "paymentDate"
  | "reference"
  | "method";

export type PaymentFieldDef = {
  key: PaymentFieldKey;
  label: string;
  type: "text" | "number" | "date";
  required: boolean;
  hint?: string;
};

/**
 * Campos de una planilla de cobros.
 *
 * Ninguna de las dos llaves de match es obligatoria por separado, pero **hace falta
 * al menos una**: sin saber a quién corresponde el cobro no hay nada que hacer con
 * él. Esa regla se valida aparte, porque no se puede expresar con un booleano por
 * campo.
 */
export const PAYMENT_FIELDS: PaymentFieldDef[] = [
  {
    key: "matchExternalId",
    label: "ID del deudor",
    type: "text",
    required: false,
    hint: "El mismo código que usaste al importar la cartera. Es el match más confiable.",
  },
  {
    key: "matchDocument",
    label: "Documento del deudor",
    type: "text",
    required: false,
    hint: "Alternativa si tu archivo de cobros no trae el código interno.",
  },
  {
    key: "amount",
    label: "Monto cobrado",
    type: "number",
    required: true,
  },
  {
    key: "paymentDate",
    label: "Fecha de cobro",
    type: "date",
    required: true,
  },
  {
    key: "reference",
    label: "Referencia / comprobante",
    type: "text",
    required: false,
    hint: "Sin esto no se puede detectar si un cobro ya fue cargado. Mapealo si existe.",
  },
  {
    key: "invoiceNumber",
    label: "Nro. de comprobante a imputar",
    type: "text",
    required: false,
    hint: "Si viene, el cobro se aplica a ese comprobante. Si no, a los más viejos primero.",
  },
  {
    key: "method",
    label: "Medio de pago",
    type: "text",
    required: false,
  },
];

const ALIASES: Record<PaymentFieldKey, string[]> = {
  matchExternalId: ["id", "idcliente", "codigo", "codigocliente", "nrocliente", "cuenta", "cliente", "externalid"],
  matchDocument: ["documento", "ci", "ruc", "cedula", "dni", "documentodeudor", "nrodocumento"],
  invoiceNumber: ["factura", "nrofactura", "comprobante", "nrocomprobante", "boleta", "imputacion"],
  amount: ["monto", "importe", "montocobrado", "cobrado", "pago", "montopago", "valor", "total"],
  paymentDate: ["fechacobro", "fechapago", "fecha", "paymentdate"],
  reference: ["referencia", "nrooperacion", "operacion", "comprobantepago", "transaccion", "nrotransaccion", "ticket"],
  method: ["medio", "mediopago", "formapago", "metodo", "metodopago", "tipopago"],
};

export function suggestPaymentMapping(
  headers: string[],
): Partial<Record<PaymentFieldKey, string>> {
  return matchHeaders(headers, ALIASES);
}

/**
 * Medio de pago desde texto libre. Lo que no se reconoce cae en OTHER en vez de
 * rechazar la fila: el medio es informativo y perder un cobro por no entender
 * "transf." sería absurdo.
 */
/**
 * Los medios de pago, con su etiqueta. **Una sola lista para todo el producto:**
 * el importador, el modal de cobro y el reporte de recupero por método leen de acá.
 *
 * Los cinco del medio son los de Paraguay. Sin ellos, un cobro hecho en una boca de
 * cobranza entra como OTHER y el reporte por método no sirve para decidir dónde
 * conviene empujar la cobranza.
 */
export const PAYMENT_METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: "BANK_TRANSFER", label: "Transferencia" },
  { value: "CASH", label: "Efectivo" },
  { value: "DEPOSIT", label: "Depósito" },
  { value: "CARD", label: "Tarjeta" },
  { value: "CHECK", label: "Cheque" },
  { value: "BANCARD", label: "Bancard" },
  { value: "TIGO_MONEY", label: "Tigo Money" },
  { value: "PERSONAL_ENVIOS", label: "Personal Envíos" },
  { value: "PAGO_EXPRESS", label: "Pago Express" },
  { value: "AQUI_PAGO", label: "Aquí Pago" },
  { value: "OTHER", label: "Otro" },
] as const;

export const PAYMENT_METHOD_VALUES = PAYMENT_METHODS.map((m) => m.value) as [
  PaymentMethod,
  ...PaymentMethod[],
];

const PAYMENT_METHOD_LABELS = new Map(
  PAYMENT_METHODS.map((m) => [m.value, m.label] as const),
);

/** Etiqueta en español de un medio de pago, para tablas y reportes. */
export function paymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS.get(method) ?? "Otro";
}

export function parsePaymentMethod(raw: unknown): PaymentMethod {
  if (raw === null || raw === undefined) return "OTHER";
  const value = normalizeHeader(String(raw));
  if (!value) return "OTHER";

  // Los medios paraguayos van primero porque varios caen en las reglas genéricas:
  // "bancard" contiene "card" y "pago express" contiene "pago". Si se evalúan
  // después, nunca se alcanzan.
  if (/(bancard|infonet)/.test(value)) return "BANCARD";
  if (/(tigomoney|billetera.?tigo|tigo)/.test(value)) return "TIGO_MONEY";
  if (/(personalenvios|billeterapersonal|personal)/.test(value))
    return "PERSONAL_ENVIOS";
  if (/(pagoexpress|pagoexpres)/.test(value)) return "PAGO_EXPRESS";
  if (/(aquipago|aqipago)/.test(value)) return "AQUI_PAGO";

  if (/(efectivo|cash|contado)/.test(value)) return "CASH";
  if (/(transf|spi|giro|wire|banco)/.test(value)) return "BANK_TRANSFER";
  if (/(tarjeta|card|credito|debito|pos)/.test(value)) return "CARD";
  if (/(cheque|check)/.test(value)) return "CHECK";
  if (/(deposito|deposit)/.test(value)) return "DEPOSIT";

  return "OTHER";
}
