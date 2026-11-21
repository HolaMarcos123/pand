import { matchHeaders } from "@/lib/import/normalize-header";
import { clasificarColumna, type ClaseDeColumna } from "@/lib/import/parse-values";
import type { CampoPropio } from "@/lib/config/settings";
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

/**
 * La clave de un campo mapeable. O uno de Pand, o uno propio de la
 * organizacion con el prefijo `custom:`.
 *
 * Es `string` y no una union porque los propios se definen en tiempo de
 * ejecucion; `esCampoPropio` e `idDelCampoPropio` son la forma de distinguirlos.
 */
export type MappableKey = string;

export const PREFIJO_PROPIO = "custom:";

export function esCampoPropio(key: MappableKey): boolean {
  return key.startsWith(PREFIJO_PROPIO);
}

export function idDelCampoPropio(key: MappableKey): string {
  return key.slice(PREFIJO_PROPIO.length);
}

export type FieldDef = {
  key: MappableKey;
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

/**
 * Los campos a los que se puede mapear una columna: los de Pand con las
 * etiquetas del sector, mas los propios de la organizacion.
 *
 * Los propios van al final y nunca son obligatorios: son datos que la
 * financiera quiere conservar, no algo sin lo cual no se puede gestionar.
 */
export function fieldsFor(
  sector: Sector,
  camposPropios: CampoPropio[] = [],
): FieldDef[] {
  const overrides = OVERRIDES[sector];

  const propios: FieldDef[] = camposPropios.map((campo) => ({
    key: `${PREFIJO_PROPIO}${campo.id}`,
    label: campo.label,
    type: campo.tipo === "numero" ? "number" : campo.tipo === "fecha" ? "date" : "text",
    required: false,
  }));

  return [
    ...BASE.map((field) => ({
      ...field,
      label: overrides[field.key as FieldKey] ?? field.label,
    })),
    ...propios,
  ];
}

export const REQUIRED_FIELDS: MappableKey[] = BASE.filter((f) => f.required).map(
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
  // Las abreviaturas van explicitas: las planillas reales escriben "COD CLIENTE"
  // y "NRO CLI", no "Codigo de cliente".
  externalId: ["id", "idcliente", "idcli", "codigo", "codigocliente", "cod", "codcliente", "codcli", "nrocliente", "nrocli", "numerocliente", "cuenta", "nrocuenta", "externalid", "cliente"],
  name: ["nombre", "razonsocial", "titular", "deudor", "nombredeudor", "cliente", "nombrecompleto"],
  documentNumber: ["documento", "ci", "ruc", "cedula", "dni", "cuit", "nrodocumento", "documentnumber"],
  email: ["email", "correo", "mail", "correoelectronico"],
  phone: ["telef1", "tel1", "telefono1", "telefono", "tel", "celular", "movil", "phone", "contacto"],
  phoneAlt: ["telef2", "tel2", "telefono2", "telalternativo", "telefonoalternativo", "celular2", "otrotelefono"],
  loanNumber: ["operacion", "nrooperacion", "oper", "prestamo", "nroprestamo", "credito", "nrocredito", "contrato", "nrocontrato", "solicitud", "nrosolicitud"],
  // "nrcuo" y "cuo" van explicitas: la planilla real escribe "NR_CUO", que al
  // normalizar queda "nrcuo" y no matcheaba contra "nrocuo".
  invoiceNumber: ["nrcuo", "nrocuo", "cuo", "nrcuota", "nrocuota", "numerocuota", "cuotanro", "cuota", "factura", "nrfactura", "nrofactura", "numerofactura", "comprobante", "nrocomprobante", "boleta", "invoice"],
  product: ["producto", "articulo", "item", "bien", "linea", "lineacredito", "plan", "servicio", "tipoproducto", "product"],
  amount: ["montocuota", "importecuota", "valorcuota", "cuota", "monto", "importe", "saldo", "deuda", "total", "amount", "valor"],
  dueDate: ["fchvto", "fchvencimiento", "fvto", "vencimiento", "fechavencimiento", "fechavto", "vto", "duedate", "fecha"],
  // Sin "mon": por startsWith se llevaba "MONTO_APLICADO".
  currency: ["moneda", "divisa", "currency", "tipomoneda", "monedacredito", "tipocambio"],
  description: ["descripcion", "detalle", "concepto", "observacion", "description"],
  referenceName: ["referencia", "nombrereferencia", "referencianombre", "contactoreferencia", "garante", "nombregarante"],
  referencePhone: ["telefonoreferencia", "referenciatelefono", "telreferencia", "telefonogarante", "celularreferencia"],
  referenceRelation: ["vinculo", "parentesco", "relacion", "vinculoreferencia"],
};

/**
 * Campos cuyo valor es un identificador o un nombre. Una columna con forma de
 * plata nunca es uno de estos, por mas que el encabezado se parezca.
 */
const IDENTIFICADORES = new Set<FieldKey>([
  "externalId",
  "name",
  "documentNumber",
  "loanNumber",
  "invoiceNumber",
]);

/**
 * Adivina el mapeo mirando los encabezados Y los datos.
 *
 * Por que los datos: en el cuotero de una financiera conviven "NR_CUO" con
 * "13/35" —la cuota— y "CUOTA" con "66,00" —la plata—. Adivinando solo por
 * nombre, "CUOTA" se lleva el campo del numero de cuota, y como ademas existe
 * una columna "MONTO_APLICADO" en cero, el monto de la deuda se toma de ahi: la
 * cartera entera entraria con deuda cero. Las dos cosas se evitan preguntandole
 * a la columna que trae.
 *
 * Sin filas de muestra se comporta como antes, solo por nombre.
 */
export function suggestMapping(
  headers: string[],
  rows: Record<string, unknown>[] = [],
): Partial<Record<FieldKey, string>> {
  if (rows.length === 0) return matchHeaders(headers, ALIASES);

  const muestra = rows.slice(0, 30);
  const clase = new Map<FieldKey | string, ClaseDeColumna>();
  for (const header of headers) {
    clase.set(header, clasificarColumna(muestra.map((row) => row[header])));
  }

  const yaAsignado: Partial<Record<FieldKey, string>> = {};

  // Una sola columna con forma "13/35" en toda la planilla es el numero de
  // cuota, se llame como se llame. Es la senal mas fuerte que hay y por eso va
  // antes que cualquier alias.
  const fracciones = headers.filter((h) => clase.get(h) === "fraccion");
  if (fracciones.length === 1) yaAsignado.invoiceNumber = fracciones[0];

  // Lo mismo con las fechas: si en toda la planilla hay una sola columna con
  // forma de fecha, es el vencimiento, se llame "FCH_VTO" o como sea. Con dos o
  // mas —otorgamiento y vencimiento, por ejemplo— no se adivina y deciden los
  // alias.
  const fechas = headers.filter((h) => clase.get(h) === "fecha");
  if (fechas.length === 1) yaAsignado.dueDate = fechas[0];

  const compatible = (key: FieldKey, header: string, estricto: boolean) => {
    const c = clase.get(header) ?? "texto";
    const tipo = BASE.find((f) => f.key === key)?.type;

    if (tipo === "number") {
      if (c === "texto" || c === "fraccion" || c === "fecha") return false;
      // En la primera pasada no se acepta una columna que esta toda en cero:
      // casi siempre es un "aplicado" o "pagado" sin usar, y tomarla como el
      // monto de la deuda deja la cartera en cero sin que nadie lo note.
      return estricto ? c !== "montocero" : true;
    }

    if (tipo === "date") return c === "fecha";
    if (IDENTIFICADORES.has(key)) return c !== "monto" && c !== "montocero";
    return true;
  };

  const primera = matchHeaders(headers, ALIASES, {
    yaAsignado,
    compatible: (key, header) => compatible(key, header, true),
  });

  // Segunda pasada para lo que quedo sin resolver, aflojando el veto. Mejor un
  // campo obligatorio con una columna dudosa —que la persona ve y corrige en la
  // pantalla, con el ejemplo al lado— que dejarselo vacio.
  return matchHeaders(headers, ALIASES, {
    yaAsignado: primera,
    compatible: (key, header) => compatible(key, header, false),
  });
}
