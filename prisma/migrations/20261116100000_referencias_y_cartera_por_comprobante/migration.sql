-- Dos cosas del documento "Modulo Operador": saber en que cartera esta cada
-- deuda, y a quien llamar cuando el deudor no atiende.

-- ─────────── Cartera por comprobante ───────────
-- Hasta ahora la cartera colgaba del deudor. Pero un mismo deudor puede figurar
-- en varias —la de consumo y la prendaria, o la propia y una comprada a otra
-- financiera— y el operador necesita saber cual esta gestionando.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "portfolio_id" UUID;

ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_portfolio_id_fkey";
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_portfolio_id_fkey"
  FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "invoices_portfolio_id_idx"
    ON "invoices" ("portfolio_id")
 WHERE "portfolio_id" IS NOT NULL;

-- Backfill: hasta hoy la unica cartera posible era la del deudor, asi que esa es
-- la respuesta correcta para todo lo ya importado. Sin esto, cada comprobante
-- existente se mostraria sin cartera y pareceria que el dato se perdio.
UPDATE "invoices" i
   SET "portfolio_id" = c."portfolio_id"
  FROM "clients" c
 WHERE c."id" = i."client_id"
   AND i."portfolio_id" IS NULL
   AND c."portfolio_id" IS NOT NULL;

-- ─────────── Referencias personales ───────────
-- Tabla y no dos columnas mas en clients: la cantidad varia entre clientes de
-- Pand, y sobre una referencia se va a querer registrar gestiones.
CREATE TABLE IF NOT EXISTS "client_references" (
    "id"              UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "client_id"       UUID NOT NULL,
    "name"            TEXT NOT NULL,
    "phone"           TEXT,
    "relation"        TEXT,
    "notes"           TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_references_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_references_organization_id_idx"
    ON "client_references" ("organization_id");
CREATE INDEX IF NOT EXISTS "client_references_client_id_idx"
    ON "client_references" ("client_id");

ALTER TABLE "client_references"
  ADD CONSTRAINT "client_references_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "client_references"
  ADD CONSTRAINT "client_references_client_id_fkey"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Misma politica que el resto: aislamiento por organizacion con current_org_id().
-- Ver la migracion 20260824010000_rls.
ALTER TABLE "client_references" ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_references_tenant_isolation ON "client_references"
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
