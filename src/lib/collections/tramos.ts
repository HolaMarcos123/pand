import { Prisma } from "@/generated/prisma/client";
import type { InvoiceStatus } from "@/generated/prisma/enums";

/**
 * El catálogo de tramos de mora. **Uno solo, para todo el producto.**
 *
 * Esto es una respuesta directa al bug #2 del QA de CobrAI: ahí la pantalla de inicio
 * usa 10 tramos por días, Cobranzas usa 7 con etapas legales y Reportes usa otros
 * nombres. Un gerente de cobranzas lo detecta enseguida porque los totales por tramo
 * no se pueden comparar entre pantallas.
 *
 * Acá los límites se declaran una vez y de esa declaración salen las dos cosas que
 * los necesitan: la función de TypeScript y la expresión SQL. No se pueden
 * desincronizar porque no hay dos definiciones.
 */

export type Tramo =
  | "AL_DIA"
  | "T1_30"
  | "T31_60"
  | "T61_90"
  | "PRE_LEGAL"
  | "LEGAL"
  | "CASTIGO";

type Bound = { key: Tramo; label: string; hasta: number | null };

/**
 * Tramos por días de mora, en orden. `hasta` es el límite superior inclusivo;
 * `null` es el último y se lleva todo lo que sobra.
 *
 * Pre-legal y Legal son tramos por antigüedad, no una decisión jurídica registrada:
 * hoy Pand no tiene un expediente legal por deuda. Cuando exista, el estado
 * declarado debería ganarle a la antigüedad, igual que ya le gana el castigo.
 */
export const TRAMOS: readonly Bound[] = [
  { key: "AL_DIA", label: "Al día", hasta: 0 },
  { key: "T1_30", label: "1-30", hasta: 30 },
  { key: "T31_60", label: "31-60", hasta: 60 },
  { key: "T61_90", label: "61-90", hasta: 90 },
  { key: "PRE_LEGAL", label: "Pre-legal", hasta: 180 },
  { key: "LEGAL", label: "Legal", hasta: null },
] as const;

export const TRAMO_LABELS: Record<Tramo, string> = {
  ...Object.fromEntries(TRAMOS.map((t) => [t.key, t.label])),
  CASTIGO: "Castigo",
} as Record<Tramo, string>;

/**
 * Los tramos que componen la **cartera activa**.
 *
 * Castigo queda afuera a propósito: un crédito castigado contablemente ya no es
 * activo. Sumarlo al saldo activo infla la cartera, que es el bug #16 del QA de
 * CobrAI. Se reporta aparte.
 */
export const TRAMOS_ACTIVOS: readonly Tramo[] = TRAMOS.map((t) => t.key);

/** Estados que siguen siendo cartera cobrable. */
export const ESTADOS_ABIERTOS = ["PENDING", "PARTIAL"] as const;

/** Un comprobante castigado o refinanciado salió de la cartera activa. */
export function esCarteraActiva(status: InvoiceStatus): boolean {
  return status === "PENDING" || status === "PARTIAL";
}

/**
 * Tramo de un comprobante.
 *
 * El castigo gana sobre la antigüedad: una deuda castigada de 400 días es Castigo,
 * no Legal. Es lo que esperan ver en la tabla.
 */
export function tramoDe(daysOverdue: number, status: InvoiceStatus): Tramo {
  if (status === "WRITTEN_OFF") return "CASTIGO";
  for (const t of TRAMOS) {
    if (t.hasta === null || daysOverdue <= t.hasta) return t.key;
  }
  return "LEGAL";
}

/**
 * La misma clasificación, como expresión SQL, generada de la misma tabla de límites.
 *
 * Se usa en las agregaciones, donde clasificar en JavaScript obligaría a traer cada
 * comprobante solo para contarlo.
 */
export function tramoSql(
  diasCol: Prisma.Sql = Prisma.raw("i.days_overdue"),
  estadoCol: Prisma.Sql = Prisma.raw("i.status"),
): Prisma.Sql {
  const ramas = TRAMOS.filter((t) => t.hasta !== null).map(
    (t) => Prisma.sql`WHEN ${diasCol} <= ${t.hasta} THEN ${t.key}`,
  );

  return Prisma.sql`CASE
    WHEN ${estadoCol} = 'WRITTEN_OFF' THEN 'CASTIGO'
    ${Prisma.join(ramas, " ")}
    ELSE ${TRAMOS[TRAMOS.length - 1].key}
  END`;
}
