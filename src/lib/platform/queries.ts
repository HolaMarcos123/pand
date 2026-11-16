import type { Plan, Sector } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

/**
 * Consultas del backoffice.
 *
 * Son las únicas del producto que **no** filtran por organización, y eso es
 * intencional: miran todas las empresas clientes a la vez. Precisamente por eso
 * viven en su propio módulo y no en `queries/`, donde la regla es la contraria y
 * no quiero que alguien copie una de acá por error.
 *
 * Quien las llama tiene que haber verificado `getPlatformSession` antes.
 */

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  sector: Sector;
  plan: Plan;
  seatsUsed: number;
  seatsMax: number;
  trialEnds: string | null;
  suspendedAt: string | null;
  createdAt: string;
  usuarios: number;
  deudores: number;
  /** Saldo abierto: la plata que esa empresa está gestionando hoy. */
  carteraAbierta: number;
  /** Última gestión o cobro cargado. Delata una cuenta que dejó de usarse. */
  ultimaActividad: string | null;
};

export async function listTenants(): Promise<TenantRow[]> {
  return prisma.$queryRaw<TenantRow[]>`
    SELECT o.id,
           o.name,
           o.slug,
           o.sector,
           o.plan,
           o.seats_used                     AS "seatsUsed",
           o.seats_max                      AS "seatsMax",
           to_char(o.trial_ends,   'YYYY-MM-DD')      AS "trialEnds",
           to_char(o.suspended_at, 'YYYY-MM-DD')      AS "suspendedAt",
           to_char(o.created_at,   'YYYY-MM-DD')      AS "createdAt",
           (SELECT COUNT(*)::int FROM users u
             WHERE u.organization_id = o.id AND u.is_active)        AS usuarios,
           (SELECT COUNT(*)::int FROM clients c
             WHERE c.organization_id = o.id)                        AS deudores,
           (SELECT COALESCE(SUM(i.amount - i.paid_amount), 0)::float8
              FROM invoices i
             WHERE i.organization_id = o.id
               AND i.status IN ('PENDING', 'PARTIAL'))              AS "carteraAbierta",
           -- La más reciente entre la última gestión y el último cobro: una
           -- cuenta puede estar cobrando sin gestionar, o al revés.
           to_char(GREATEST(
             (SELECT MAX(ma.created_at) FROM management_actions ma
               WHERE ma.organization_id = o.id),
             (SELECT MAX(p.created_at) FROM payments p
               WHERE p.organization_id = o.id)
           ), 'YYYY-MM-DD')                                         AS "ultimaActividad"
      FROM organizations o
     ORDER BY o.suspended_at NULLS FIRST, o.created_at DESC
  `;
}

export type PlatformTotals = {
  organizaciones: number;
  suspendidas: number;
  usuarios: number;
  deudores: number;
  carteraAbierta: number;
};

export async function getPlatformTotals(): Promise<PlatformTotals> {
  const rows = await prisma.$queryRaw<[PlatformTotals]>`
    SELECT (SELECT COUNT(*)::int FROM organizations)                 AS organizaciones,
           (SELECT COUNT(*)::int FROM organizations
             WHERE suspended_at IS NOT NULL)                         AS suspendidas,
           (SELECT COUNT(*)::int FROM users WHERE is_active)         AS usuarios,
           (SELECT COUNT(*)::int FROM clients)                       AS deudores,
           (SELECT COALESCE(SUM(amount - paid_amount), 0)::float8
              FROM invoices
             WHERE status IN ('PENDING', 'PARTIAL'))                 AS "carteraAbierta"
  `;

  return (
    rows[0] ?? {
      organizaciones: 0,
      suspendidas: 0,
      usuarios: 0,
      deudores: 0,
      carteraAbierta: 0,
    }
  );
}
