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
  // "telef3" explicito: sin el, "tel" por prefijo se llevaba cualquier cosa, y
  // en un cuotero real TELEF1 y TELEF2 vienen vacias y el unico telefono con
  // datos es el tercero.
  phone: ["telef1", "tel1", "telef3", "tel3", "telefono1", "telefono", "tel", "celular", "movil", "phone", "contacto"],
  phoneAlt: ["telef2", "tel2", "telef3", "tel3", "telefono2", "telalternativo", "telefonoalternativo", "celular2", "otrotelefono"],
  loanNumber: ["operacion", "nrooperacion", "oper", "prestamo", "nroprestamo", "credito", "nrocredito", "contrato", "nrocontrato", "solicitud", "nrosolicitud"],
  // "nrcuo" y "cuo" van explicitas: la planilla real escribe "NR_CUO", que al
  // normalizar queda "nrcuo" y no matcheaba contra "nrocuo".
  invoiceNumber: ["nrcuo", "nrocuo", "cuo", "nrcuota", "nrocuota", "numerocuota", "cuotanro", "cuota", "factura", "nrfactura", "nrofactura", "numerofactura", "comprobante", "nrocomprobante", "boleta", "invoice"],
  // "descproducto" y "modelo" explicitos: el cuotero real escribe
  // "DESC_PRODUCTO", que al normalizar queda "descproducto" y no empieza con
  // "producto", asi que la columna del bien financiado quedaba sin mapear y la
  // lista de clientes mostraba un guion en la columna Producto.
  product: ["producto", "descproducto", "descripcionproducto", "modelo", "articulo", "item", "bien", "linea", "lineacredito", "plan", "servicio", "tipoproducto", "product"],
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
 * Si una columna con esta forma puede ser este campo de Pand.
 *
 * `estricto` solo cambia una cosa: si se acepta una columna toda en cero como
 * monto. En la primera pasada del adivinador no, porque casi siempre es un
 * "aplicado" sin usar y tomarla como el monto de la deuda deja la cartera en
 * cero sin que nadie lo note.
 */
function compatibleCon(
  key: FieldKey,
  clase: ClaseDeColumna,
  estricto: boolean,
): boolean {
  // Una columna sin un solo valor no sirve para ningun campo. El caso real:
  // un cuotero trae "CONTRATO" vacia de punta a punta; el alias la tomaba como
  // "Nro. de operacion", y con la operacion ocupada por una columna que no dice
  // nada, los dos creditos del mismo deudor quedaban sin nada que los separe.
  if (clase === "vacia") return false;

  const tipo = BASE.find((f) => f.key === key)?.type;

  if (tipo === "number") {
    if (clase === "texto" || clase === "fraccion" || clase === "fecha") return false;
    return estricto ? clase !== "montocero" : true;
  }

  if (tipo === "date") return clase === "fecha";
  if (IDENTIFICADORES.has(key)) return clase !== "monto" && clase !== "montocero";
  return true;
}

/**
 * La forma de cada columna del archivo.
 *
 * Se juntan los primeros 30 valores CON contenido de cada columna, no las
 * primeras 30 filas. La diferencia importa: en un cuotero real hay columnas que
 * recien traen algo en la fila 400, y clasificarlas por las primeras 30 filas
 * las daba por vacias. Al reves tambien: una columna vacia en todo el archivo
 * queda marcada como tal y deja de competir con la que si identifica.
 */
const MUESTRA = 30;

export function clasificarColumnas(
  headers: string[],
  rows: Record<string, unknown>[],
): Map<string, ClaseDeColumna> {
  const muestras = new Map<string, unknown[]>(headers.map((h) => [h, []]));

  // Solo se miran las columnas a las que todavia les falta muestra. En un
  // cuotero real la mayoria se completa en las primeras filas y lo unico que
  // obliga a recorrer el archivo entero son las que vienen vacias, que son
  // pocas: sin esto se repasaban las 44 columnas en cada una de las 8.000
  // filas para no juntar nada.
  let pendientes = headers;

  for (const row of rows) {
    if (pendientes.length === 0) break;

    let alguna = false;
    for (const header of pendientes) {
      const valor = row[header];
      if (valor === null || valor === undefined || String(valor).trim() === "") continue;
      const valores = muestras.get(header)!;
      valores.push(valor);
      if (valores.length >= MUESTRA) alguna = true;
    }

    if (alguna) {
      pendientes = pendientes.filter((h) => muestras.get(h)!.length < MUESTRA);
    }
  }

  const clase = new Map<string, ClaseDeColumna>();
  for (const header of headers) {
    clase.set(header, clasificarColumna(muestras.get(header)!));
  }
  return clase;
}

export type MapeoDepurado = {
  mapeo: Partial<Record<MappableKey, string>>;
  /** Lo que se descarto del mapeo guardado, para poder decirlo en pantalla. */
  descartados: { campo: MappableKey; columna: string; motivo: string }[];
};

/**
 * Limpia un mapeo guardado contra el archivo que se esta subiendo.
 *
 * Un mapeo guardado se reaplica sin que nadie lo mire, asi que si quedo mal una
 * vez queda mal para siempre y en silencio. El caso real: "Nro. de cuota"
 * apuntando a una columna de plata; al importar, dos cuotas del mismo credito
 * comparten el "375,00" y la carga se corta entera sin que se entienda por que.
 *
 * Se aplica el mismo veto que usa el adivinador, con una diferencia: aca no se
 * es estricto con el monto en cero. Si la persona eligio esa columna a mano
 * alguna vez, puede tener razon —este archivo quizas si trae todo en cero—;
 * lo que no puede ser es un identificador tomando una columna de plata.
 *
 * Los campos propios nunca se descartan: Pand no hace cuentas con ellos y
 * ahora aceptan cualquier valor, asi que no hay forma de que esten "mal".
 */
export function depurarMapeoGuardado(
  guardado: Record<string, string>,
  headers: string[],
  rows: Record<string, unknown>[] = [],
): MapeoDepurado {
  const clase = rows.length > 0 ? clasificarColumnas(headers, rows) : null;
  const mapeo: Partial<Record<MappableKey, string>> = {};
  const descartados: MapeoDepurado["descartados"] = [];

  for (const [campo, columna] of Object.entries(guardado)) {
    if (!headers.includes(columna)) continue; // el archivo no trae esa columna

    if (!clase || esCampoPropio(campo)) {
      mapeo[campo] = columna;
      continue;
    }

    const forma = clase.get(columna) ?? "texto";
    if (compatibleCon(campo as FieldKey, forma, false)) {
      mapeo[campo] = columna;
      continue;
    }

    descartados.push({
      campo,
      columna,
      motivo:
        forma === "vacia"
          ? "viene vacía"
          : forma === "monto" || forma === "montocero"
          ? "trae importes"
          : forma === "fecha"
            ? "trae fechas"
            : forma === "fraccion"
              ? "trae cuotas tipo 13/35"
              : "trae texto",
    });
  }

  return { mapeo, descartados };
}

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

  const clase = clasificarColumnas(headers, rows);

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

  const compatible = (key: FieldKey, header: string, estricto: boolean) =>
    compatibleCon(key, clase.get(header) ?? "texto", estricto);

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
