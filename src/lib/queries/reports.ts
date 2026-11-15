import { Prisma } from "@/generated/prisma/client";
import type { ActionType, PaymentMethod } from "@/generated/prisma/enums";
import type { Period } from "@/lib/collections/period";
import { prisma } from "@/lib/prisma";

/**
 * Consultas de los reportes (Bloque 3).
 *
 * Tres reportes, los que el QA de CobrAI llama «los 3 KPIs clásicos»: recupero del
 * período, contactabilidad por canal y cumplimiento de promesas.
 *
 * Valen las mismas dos reglas que en `queries/dashboard`:
 *
 *   1. TODA consulta filtra por organization_id. Prisma corre como `postgres`, que
 *      tiene BYPASSRLS: las policies no van a atajar un olvido acá.
 *   2. Montos a ::float8 y conteos a ::int, porque node-postgres devuelve numeric
 *      como string y count como BigInt, y ninguno de los dos cruza a un Client
 *      Component ni se suma.
 *
 * Y una tercera, propia de los reportes: el período se pasa siempre explícito, como
 * dos fechas. Nada de `date_trunc('month', CURRENT_DATE)` escondido adentro de la
 * consulta, porque entonces el título de la pantalla y el número que muestra pueden
 * decir cosas distintas.
 */

export {
  currentMonth,
  parsePeriod,
  todayInParaguay,
  type Period,
} from "@/lib/collections/period";

// ──────────────────── 1. Recupero del período ────────────────────

export type RecoverySummary = {
  collected: number;
  paymentsCount: number;
  averageTicket: number;
  /** Deudores distintos que pagaron algo en el período. */
  payers: number;
  byMethod: { method: PaymentMethod; count: number; amount: number }[];
};

export async function getRecovery(
  organizationId: string,
  period: Period,
): Promise<RecoverySummary> {
  const [totals, byMethod] = await Promise.all([
    prisma.$queryRaw<[{ amount: number; count: number; payers: number }]>`
      SELECT COALESCE(SUM(amount), 0)::float8     AS amount,
             COUNT(*)::int                        AS count,
             COUNT(DISTINCT client_id)::int       AS payers
        FROM payments
       WHERE organization_id = ${organizationId}::uuid
         AND payment_date BETWEEN ${period.from}::date AND ${period.to}::date
    `,
    prisma.$queryRaw<{ method: PaymentMethod; count: number; amount: number }[]>`
      SELECT payment_method                   AS method,
             COUNT(*)::int                    AS count,
             COALESCE(SUM(amount), 0)::float8 AS amount
        FROM payments
       WHERE organization_id = ${organizationId}::uuid
         AND payment_date BETWEEN ${period.from}::date AND ${period.to}::date
       GROUP BY 1
       ORDER BY amount DESC
    `,
  ]);

  const collected = totals[0]?.amount ?? 0;
  const paymentsCount = totals[0]?.count ?? 0;

  return {
    collected,
    paymentsCount,
    averageTicket: paymentsCount ? collected / paymentsCount : 0,
    payers: totals[0]?.payers ?? 0,
    byMethod,
  };
}

// ────────────────── 2. Contactabilidad por canal ──────────────────

/**
 * Resultados que significan que del otro lado hubo alguien.
 *
 * Es la definición que decide todo el reporte, así que conviene tenerla en un solo
 * lugar: «no atiende», «ocupado» y «número equivocado» son intentos, no contactos.
 * Una gestión sin resultado cargado tampoco cuenta como contacto.
 */
const CONTACTO_EFECTIVO = ["PROMISE_PAY", "REFUSED", "PAID", "CALLBACK"] as const;

/** Canales de contacto. NOTE y PROMISE no son canales: son anotaciones. */
const CANALES = ["CALL", "WHATSAPP", "EMAIL", "SMS", "VISIT", "AI_CALL"] as const;

export type ChannelRow = {
  channel: ActionType;
  attempts: number;
  contacts: number;
  /** % de gestiones donde hubo alguien del otro lado. */
  contactRate: number;
  promises: number;
  promisedAmount: number;
};

export async function getContactability(
  organizationId: string,
  period: Period,
): Promise<ChannelRow[]> {
  const rows = await prisma.$queryRaw<
    {
      channel: ActionType;
      attempts: number;
      contacts: number;
      promises: number;
      promisedAmount: number;
    }[]
  >`
    SELECT ma.action_type AS channel,
           COUNT(*)::int  AS attempts,
           COUNT(*) FILTER (
             WHERE ma.result = ANY(${CONTACTO_EFECTIVO as unknown as string[]}::"ActionResult"[])
           )::int AS contacts,
           COUNT(*) FILTER (WHERE ma.result = 'PROMISE_PAY')::int AS promises,
           COALESCE(
             SUM(ma.promise_amount) FILTER (WHERE ma.result = 'PROMISE_PAY'), 0
           )::float8 AS "promisedAmount"
      FROM management_actions ma
     WHERE ma.organization_id = ${organizationId}::uuid
       AND ma.action_type = ANY(${CANALES as unknown as string[]}::"ActionType"[])
       AND ma.created_at >= ${period.from}::date
       AND ma.created_at < ${period.to}::date + 1
     GROUP BY 1
  `;

  const encontrados = new Map(rows.map((row) => [row.channel, row]));

  // Todos los canales, siempre, también los que no se usaron: un canal en cero es
  // información — dice que el equipo no lo está usando.
  return CANALES.map((channel) => {
    const row = encontrados.get(channel);
    const attempts = row?.attempts ?? 0;
    const contacts = row?.contacts ?? 0;

    return {
      channel,
      attempts,
      contacts,
      contactRate: attempts ? (contacts / attempts) * 100 : 0,
      promises: row?.promises ?? 0,
      promisedAmount: row?.promisedAmount ?? 0,
    };
  });
}

// ─────────────── 3. Cumplimiento de promesas ───────────────

/**
 * Días de gracia antes de dar una promesa por rota.
 *
 * Un pago hecho el lunes por una promesa del viernes se acreditó tarde, no se
 * incumplió. Sin la gracia, el reporte castiga al operador por el calendario
 * bancario.
 */
const GRACIA_DIAS = 3;

export type PromiseState = "CUMPLIDA" | "PARCIAL" | "ROTA" | "VIGENTE";

export const PROMISE_STATE_LABELS: Record<PromiseState, string> = {
  CUMPLIDA: "Cumplidas",
  PARCIAL: "Pagadas en parte",
  ROTA: "Rotas",
  VIGENTE: "Vigentes",
};

export type PromiseStateRow = {
  state: PromiseState;
  count: number;
  promised: number;
  /**
   * Lo cobrado **imputado a la promesa**, topeado en el monto prometido.
   *
   * El tope no es un detalle: en los datos de demostración un deudor que pagó el
   * doble de lo que prometió dejaba el cumplimiento en 208 %. Sin topear, un solo
   * sobrepago tapa diez promesas rotas y el indicador deja de servir.
   */
  honored: number;
};

export type BrokenPromise = {
  id: string;
  clientId: string;
  clientName: string;
  phone: string | null;
  operatorName: string | null;
  promised: number;
  paid: number;
  promiseDate: string;
  daysLate: number;
};

export type PromisesReport = {
  byState: PromiseStateRow[];
  totalPromised: number;
  totalHonored: number;
  /** % del monto prometido que efectivamente entró, sobre promesas ya vencidas. */
  complianceRate: number;
  broken: BrokenPromise[];
};

/**
 * Promesas que **vencen** en el período, con lo que se pagó contra cada una.
 *
 * Se mide por fecha prometida y no por fecha de carga: la pregunta del reporte es
 * «de lo que había que cobrar esta semana, cuánto entró», y una promesa cargada en
 * marzo para abril se juzga en abril.
 *
 * El DISTINCT ON evita el doble conteo: si al deudor se lo llamó tres veces y
 * reprometió para la misma fecha, es una sola promesa — la última. Sin eso, el monto
 * prometido del mes sale multiplicado por la insistencia del operador.
 *
 * Se devuelve como fragmento para que el resumen por estado y el top de rotas usen
 * exactamente la misma definición. Dos consultas con el mismo CTE copiado es como
 * empiezan los reportes que no cierran entre sí.
 */
function promesasDelPeriodo(organizationId: string, period: Period): Prisma.Sql {
  return Prisma.sql`
    WITH promesas AS (
      SELECT DISTINCT ON (ma.client_id, ma.promise_date)
             ma.id,
             ma.client_id,
             ma.operator_id,
             ma.promise_amount::float8 AS promised,
             ma.promise_date,
             ma.created_at
        FROM management_actions ma
       WHERE ma.organization_id = ${organizationId}::uuid
         AND ma.result = 'PROMISE_PAY'
         AND ma.promise_amount IS NOT NULL
         AND ma.promise_date BETWEEN ${period.from}::date AND ${period.to}::date
       ORDER BY ma.client_id, ma.promise_date, ma.created_at DESC
    ),
    evaluadas AS (
      SELECT p.*,
             -- Lo cobrado a ese deudor entre la promesa y su vencimiento + gracia.
             (SELECT COALESCE(SUM(pay.amount), 0)::float8
                FROM payments pay
               WHERE pay.organization_id = ${organizationId}::uuid
                 AND pay.client_id = p.client_id
                 AND pay.payment_date >= p.created_at::date
                 AND pay.payment_date <= p.promise_date + ${GRACIA_DIAS}::int) AS paid
        FROM promesas p
    ),
    clasificadas AS (
      SELECT e.*,
             -- Nunca más que lo prometido: ver PromiseStateRow.honored.
             LEAST(e.paid, e.promised) AS honored,
             CASE
               WHEN e.paid >= e.promised THEN 'CUMPLIDA'
               -- Todavía no se le venció la gracia: no se la puede dar por rota.
               WHEN e.promise_date + ${GRACIA_DIAS}::int >= CURRENT_DATE THEN 'VIGENTE'
               WHEN e.paid > 0 THEN 'PARCIAL'
               ELSE 'ROTA'
             END AS state
        FROM evaluadas e
    )
  `;
}

export async function getPromises(
  organizationId: string,
  period: Period,
): Promise<PromisesReport> {
  const cte = promesasDelPeriodo(organizationId, period);

  const [states, broken] = await Promise.all([
    prisma.$queryRaw<PromiseStateRow[]>`
      ${cte}
      SELECT state,
             COUNT(*)::int                      AS count,
             COALESCE(SUM(promised), 0)::float8 AS promised,
             COALESCE(SUM(honored), 0)::float8  AS honored
        FROM clasificadas
       GROUP BY 1
    `,
    // Top 20 de promesas rotas, lo que el QA de CobrAI pide explícitamente. Ordenado
    // por monto: es la lista de llamadas del supervisor para mañana a la mañana.
    prisma.$queryRaw<BrokenPromise[]>`
      ${cte}
      SELECT c.id,
             c.client_id                              AS "clientId",
             cl.name                                  AS "clientName",
             cl.phone,
             u.full_name                              AS "operatorName",
             c.promised,
             c.paid,
             to_char(c.promise_date, 'YYYY-MM-DD')    AS "promiseDate",
             (CURRENT_DATE - c.promise_date)::int     AS "daysLate"
        FROM clasificadas c
        JOIN clients cl ON cl.id = c.client_id
        LEFT JOIN users u ON u.id = c.operator_id
       WHERE c.state IN ('ROTA', 'PARCIAL')
       ORDER BY (c.promised - c.paid) DESC, c.promise_date ASC
       LIMIT 20
    `,
  ]);

  const encontrados = new Map(states.map((row) => [row.state, row]));

  const byState = (
    ["CUMPLIDA", "PARCIAL", "ROTA", "VIGENTE"] as PromiseState[]
  ).map((state) => ({
    state,
    count: encontrados.get(state)?.count ?? 0,
    promised: encontrados.get(state)?.promised ?? 0,
    honored: encontrados.get(state)?.honored ?? 0,
  }));

  const totalPromised = byState.reduce((sum, row) => sum + row.promised, 0);
  // El cumplimiento se mide sobre lo ya vencido: meter las vigentes en el divisor
  // haría que el indicador empiece el mes en cero y suba solo por el paso del
  // tiempo, sin que nadie cobre nada.
  const vencidas = byState.filter((row) => row.state !== "VIGENTE");
  const promisedDue = vencidas.reduce((sum, row) => sum + row.promised, 0);
  const honoredDue = vencidas.reduce((sum, row) => sum + row.honored, 0);

  return {
    byState,
    totalPromised,
    totalHonored: byState.reduce((sum, row) => sum + row.honored, 0),
    complianceRate: promisedDue ? (honoredDue / promisedDue) * 100 : 0,
    broken,
  };
}
