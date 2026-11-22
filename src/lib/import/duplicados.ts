import type { ClaseDeColumna } from "@/lib/import/parse-values";
import { clasificarColumnas } from "@/lib/import/sector-config";
import type { MappedRow } from "@/lib/import/row-schema";
import type { ValidationOutcome } from "@/lib/import/validate-rows";

/**
 * Dos filas de la planilla que dicen ser la misma cuota del mismo credito.
 *
 * Esto lo rechaza el servidor desde que una cartera real entro mal, pero lo
 * rechazaba tarde: despues de apretar "Procesar", con la cartera ya creada y
 * con un mensaje que adivinaba la causa en vez de saberla. El navegador tiene
 * las filas desde el paso de mapeo, asi que puede decirlo antes y con nombre y
 * apellido. El chequeo del servidor queda igual: es la ultima linea.
 */

/**
 * La identidad de una deuda: deudor + operacion + cuota.
 *
 * Tiene que coincidir con la llave de `invoices`
 * (`organizationId, clientId, loanNumber, invoiceNumber`), porque es la que
 * decide si dos filas se pisan al escribir.
 */
export function claveDeDeuda(row: MappedRow): string {
  return `${row.externalId}\u0000${row.loanNumber ?? ""}\u0000${row.invoiceNumber}`;
}

/**
 * Dos filas describen la misma deuda, y no dos deudas distintas que comparten
 * numero de comprobante.
 *
 * Se comparan los campos que identifican la deuda y no los de contacto: una
 * planilla puede traer la fila del deudor repetida con el telefono corregido, y
 * eso no la convierte en otra deuda.
 */
export function mismaDeuda(a: MappedRow, b: MappedRow): boolean {
  return (
    a.externalId === b.externalId &&
    a.amount === b.amount &&
    a.dueDate === b.dueDate &&
    // La moneda entra en la comparacion: 500 dolares y 500 guaranies son la
    // misma cifra y deudas que no se parecen en nada.
    a.currency === b.currency
  );
}

export type CuotaRepetida = {
  externalId: string;
  loanNumber: string | null;
  invoiceNumber: string;
  /** Numeros de fila como los ve la persona en Excel. */
  filas: [number, number];
  /** Cuantas filas se saltean en toda la planilla, no solo esta. */
  total: number;
};

/**
 * Saca de la carga las filas que dicen ser una deuda que ya vino, y cuenta
 * cuantas son.
 *
 * Antes esto frenaba la carga entera: con una sola cuota ambigua la persona no
 * podia importar nada. En una cartera real de 7.800 filas siempre hay un par
 * —el caso que lo mostro son dos lineas del mismo credito, la entrega inicial y
 * un avance, que el ERP exporta las dos como cuota "1/1"—, asi que exigir cero
 * ambiguedad es exigir que no se importe.
 *
 * Ahora la fila ambigua se saltea y se reporta como cualquier otra fila que no
 * entra. Lo que no se hace nunca es dejarlas entrar a las dos: se pisarian en
 * la base y la deuda que quedaria seria la ultima, en silencio.
 *
 * Repetir la MISMA fila no es ambiguo —se deduplica— y es comun en planillas
 * exportadas de un ERP.
 */
export function apartarRepetidas(outcome: ValidationOutcome): ValidationOutcome & {
  repetidas: CuotaRepetida | null;
} {
  const vistas = new Map<string, { row: MappedRow; fila: number }>();
  const valid: MappedRow[] = [];
  const numeros: number[] = [];
  const errors = [...outcome.errors];
  let primera: Omit<CuotaRepetida, "total"> | undefined;
  let total = 0;

  for (let index = 0; index < outcome.valid.length; index += 1) {
    const row = outcome.valid[index];
    const fila = outcome.numeros[index];
    const clave = claveDeDeuda(row);
    const previa = vistas.get(clave);

    if (previa) {
      // La misma fila dos veces no es un problema: se deduplica y no se avisa.
      if (mismaDeuda(previa.row, row)) continue;

      total += 1;
      primera ??= {
        externalId: row.externalId,
        loanNumber: row.loanNumber ?? null,
        invoiceNumber: row.invoiceNumber,
        filas: [previa.fila, fila],
      };
      errors.push({
        row: fila,
        field: "Deuda repetida",
        message: `la misma cuota ya vino en la fila ${previa.fila} con otro monto o vencimiento`,
      });
      continue;
    }

    vistas.set(clave, { row, fila });
    valid.push(row);
    numeros.push(fila);
  }

  return {
    valid,
    numeros,
    errors,
    avisos: outcome.avisos,
    repetidas: primera ? { ...primera, total } : null,
  };
}

/** Las columnas del archivo que arman la identidad de una deuda. */
export type ColumnasDeIdentidad = {
  externalId?: string;
  loanNumber?: string;
  invoiceNumber?: string;
  amount?: string;
  dueDate?: string;
  currency?: string;
};

/** El campo de Pand que la sugerencia propone mapear. */
export type RolDeIdentidad = "loanNumber" | "invoiceNumber";

export type ArregloSugerido = {
  rol: RolDeIdentidad;
  columna: string;
  /** Choques que hay hoy, con el mapeo actual. */
  antes: number;
  /** Choques que quedarian con este arreglo. 0 es resolverlo del todo. */
  restantes: number;
  /** Filas sin valor en esa columna. Solo duelen si el rol es la cuota. */
  vacias: number;
};

const texto = (valor: unknown) =>
  valor === null || valor === undefined ? "" : String(valor).trim();

/**
 * Una fila con todo lo que no depende de la columna candidata, resuelto una
 * sola vez.
 *
 * Importa para el tiempo, no para la claridad: probar 44 columnas por dos roles
 * contra 8.000 filas rearmaba estas mismas cadenas 700.000 veces, y esto corre
 * en el navegador con cada cambio del mapeo.
 */
type FilaPreparada = {
  deudor: string;
  /** Monto, vencimiento y moneda en crudo: lo que decide si son dos deudas. */
  deuda: string;
  cuota: string;
  operacion: string;
};

function preparar(
  filas: Record<string, unknown>[],
  columnas: ColumnasDeIdentidad,
): FilaPreparada[] {
  return filas.map((fila) => ({
    deudor: texto(fila[columnas.externalId!]),
    deuda: [
      columnas.amount ? texto(fila[columnas.amount]) : "",
      columnas.dueDate ? texto(fila[columnas.dueDate]) : "",
      columnas.currency ? texto(fila[columnas.currency]) : "",
    ].join("\u0000"),
    cuota: columnas.invoiceNumber ? texto(fila[columnas.invoiceNumber]) : "",
    operacion: columnas.loanNumber ? texto(fila[columnas.loanNumber]) : "",
  }));
}

/**
 * Cuantas deudas quedarian repetidas usando `columna` como `rol`.
 *
 * Dos filas con la misma clave no son un choque si describen la misma deuda:
 * una planilla exportada de un ERP repite filas, y eso se deduplica.
 *
 * Con `columna` en `null` se mide el mapeo tal como esta, que es la linea de
 * base contra la que se compara cualquier arreglo. `tope` corta apenas el costo
 * deja de poder ganarle a la mejor candidata: una columna mala se delata en las
 * primeras filas y no hace falta recorrerla entera. Por eso se lee la columna
 * fila por fila en vez de armar antes el arreglo de valores: preparar 8.000
 * valores de una candidata que se descarta en la fila 5 costaba mas que todo
 * lo demas junto.
 */
function evaluar(
  filas: Record<string, unknown>[],
  base: FilaPreparada[],
  columna: string | null,
  rol: RolDeIdentidad,
  tope: number,
): { restantes: number; vacias: number } {
  const vistas = new Map<string, string>();
  let restantes = 0;
  let vacias = 0;

  for (let i = 0; i < base.length; i += 1) {
    const fila = base[i];
    const valor = columna === null ? "" : texto(filas[i][columna]);

    if (columna !== null && !valor) {
      vacias += 1;
      if (restantes + vacias >= tope) break;
    }

    // Sin numero de cuota la fila no entra, asi que tampoco choca con nadie.
    const cuota =
      columna !== null && rol === "invoiceNumber" ? valor : fila.cuota;
    if (!cuota) continue;

    const operacion =
      columna !== null && rol === "loanNumber" ? valor : fila.operacion;
    const clave = `${fila.deudor}\u0000${operacion}\u0000${cuota}`;

    const previa = vistas.get(clave);
    if (previa !== undefined && previa !== fila.deuda) {
      restantes += 1;
      if (restantes + vacias >= tope) break;
      continue;
    }

    vistas.set(clave, fila.deuda);
  }

  return { restantes, vacias };
}

/** Si una columna con esta forma puede ser el identificador que falta. */
function sirveComo(rol: RolDeIdentidad, clase: ClaseDeColumna): boolean {
  // Una columna vacia no identifica nada. Una con forma de plata tampoco es un
  // identificador, por mas que sus valores casi no repitan —y justamente por
  // eso ganaria cualquier ranking por unicidad.
  if (clase === "vacia" || clase === "monto" || clase === "montocero") return false;
  if (clase === "fecha") return false;
  // "13/35" es el numero de una cuota, nunca el de un credito.
  if (rol === "loanNumber" && clase === "fraccion") return false;
  return true;
}

/**
 * Que columna del archivo haria que cada deuda se distinga de las demas.
 *
 * Hay dos arreglos posibles y la diferencia entre ellos es todo el asunto:
 *
 * 1. Falta la OPERACION. El mismo deudor tiene dos creditos y los dos van por
 *    la cuota 27/60: las dos deudas son reales y lo unico que falta es la
 *    columna que separa un credito del otro. Caso real de un cuotero de autos,
 *    donde "CONTRATO" venia vacia de punta a punta y el numero del credito
 *    estaba en "NR_FACTURA".
 * 2. La CUOTA apunta al credito. El cuotero trae "NR_FACTURA" con
 *    "15701-2-3000332" —igual en sus 35 cuotas— y "NR_CUO" con "13/35", que es
 *    la cuota de verdad. Mapeada la primera, las 35 filas dicen ser una sola.
 *
 * Se prueban los dos y gana el que deja menos deudas sin distinguir, contando
 * como costo las filas sin valor: una columna casi vacia resuelve los choques
 * por no estar, no por identificar nada. Ante la misma mejora gana mapear la
 * operacion, que suma un dato sin descartar ninguna fila.
 *
 * Devuelve `null` si ninguna columna mejora lo que ya hay.
 */
export function sugerirArreglo(
  filas: Record<string, unknown>[],
  headers: string[],
  columnas: ColumnasDeIdentidad,
): ArregloSugerido | null {
  if (!columnas.externalId || filas.length === 0) return null;

  const base = preparar(filas, columnas);

  const antes = evaluar(
    filas,
    base,
    null,
    "invoiceNumber",
    Number.POSITIVE_INFINITY,
  ).restantes;
  if (antes === 0) return null;

  const enUso = new Set(
    [
      columnas.externalId,
      columnas.loanNumber,
      columnas.invoiceNumber,
      columnas.amount,
      columnas.dueDate,
      columnas.currency,
    ].filter(Boolean) as string[],
  );

  const candidatas = headers.filter((h) => !enUso.has(h));
  if (candidatas.length === 0) return null;

  const clase = clasificarColumnas(headers, filas);

  // Los dos roles se prueban siempre, tambien cuando la operacion ya esta
  // mapeada. No proponer cambiarla fue el error que dejo la pantalla sin salida
  // en la cartera real: "CONTRATO" matchea el alias de "Nro. de operacion" pero
  // viene vacia en 3.474 de 7.803 filas, y con ella quedaban 64 deudas sin
  // distinguir. La columna que si separa los creditos, "NR_FACTURA", nunca se
  // llegaba a probar porque el puesto ya estaba ocupado.
  const roles: RolDeIdentidad[] = ["loanNumber", "invoiceNumber"];

  const puntuadas = [];

  /**
   * El costo de la mejor candidata hasta ahora, que es un tope mucho mas
   * filoso que `antes`: con 4.657 choques en el archivo nada corta nunca, pero
   * apenas aparece una columna que los deja en cero, el resto se descarta en
   * las primeras filas. El +1 es para que una candidata que empata pueda
   * terminar: entre dos iguales decide el desempate, no el orden.
   */
  let mejorCosto = antes;

  for (const rol of roles) {
    for (let orden = 0; orden < candidatas.length; orden += 1) {
      const columna = candidatas[orden];
      const forma = clase.get(columna) ?? "texto";
      if (!sirveComo(rol, forma)) continue;

      const { restantes, vacias } = evaluar(
        filas,
        base,
        columna,
        rol,
        Math.min(antes, mejorCosto + 1),
      );

      // Las filas sin valor cuentan tanto como un choque. Si el rol es la
      // cuota son filas que no entran; si es la operacion son filas cuyo
      // credito Pand no sabe cual es, que es la ambiguedad que se quiere
      // sacar. Sin esto gana cualquier columna casi vacia: un
      // "NOMBRE_GARANTE" que aparece una vez cada veinte filas resuelve los
      // choques por no estar, no por identificar nada.
      const costo = restantes + vacias;
      if (costo >= antes) continue;
      if (costo < mejorCosto) mejorCosto = costo;

      puntuadas.push({
        rol,
        columna,
        restantes,
        vacias,
        costo,
        orden,
        // La forma "13/35" es la senal mas fuerte de un numero de cuota.
        esCuotaObvia: rol === "invoiceNumber" && forma === "fraccion",
      });
    }
  }

  if (puntuadas.length === 0) return null;

  puntuadas.sort(
    (a, b) =>
      a.costo - b.costo ||
      // La forma "13/35" va primero a proposito. Ante la misma mejora, una
      // columna con esa forma ES el numero de cuota; en cambio cualquier
      // columna con un valor distinto por fila —un id de linea, un numero de
      // recibo— tambien "arregla" los choques usada como operacion, diciendo
      // que cada fila es un credito aparte. Eso es cierto y es inutil.
      Number(b.esCuotaObvia) - Number(a.esCuotaObvia) ||
      // Entre las que quedan gana mapear la operacion, que no descarta filas.
      Number(b.rol === "loanNumber") - Number(a.rol === "loanNumber") ||
      a.orden - b.orden,
  );

  const { rol, columna, restantes, vacias } = puntuadas[0];
  return { rol, columna, antes, restantes, vacias };
}
