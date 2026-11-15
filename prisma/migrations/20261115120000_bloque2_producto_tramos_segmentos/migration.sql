-- Bloque 2: acercar el modelo de datos al de CobrAI sin importar sus inconsistencias.

-- ─────────────── Estados de comprobante ───────────────
-- REFINANCED: la deuda se reemplazo por otra. Sale de la cartera activa sin estar
-- pagada.
-- WRITTEN_OFF (Castigo): contablemente ya no es activo, pero se sigue pudiendo
-- recuperar. Igual que REFINANCED, NO cuenta como cartera activa: el bug #16 del QA
-- de CobrAI es justamente que el castigo suma al saldo activo e infla la cartera.
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'REFINANCED';
ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';

-- ─────────────── Medios de pago de Paraguay ───────────────
-- Un deudor local paga en una boca de cobranza o con una billetera, no por
-- "transferencia generica". Sin estos valores, el reporte de recupero por metodo
-- termina con todo en OTHER y no sirve para decidir nada.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANCARD';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'TIGO_MONEY';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PERSONAL_ENVIOS';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PAGO_EXPRESS';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'AQUI_PAGO';

-- ─────────────── Producto del comprobante ───────────────
-- Que se le vendio o presto. Aparte de `description` porque se filtra y se reporta
-- por producto, y un texto libre no sirve para agrupar.
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "product" TEXT;

-- Indice para el filtro y el futuro aging pivot por producto. Parcial: las filas sin
-- producto no aportan nada al indice y son muchas en carteras ya importadas.
CREATE INDEX IF NOT EXISTS "invoices_organization_id_product_idx"
    ON "invoices" ("organization_id", "product")
 WHERE "product" IS NOT NULL;

-- ─────────────── Segmentos (filtros guardados) ───────────────
CREATE TABLE IF NOT EXISTS "segments" (
    "id"              UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name"            TEXT NOT NULL,
    -- El querystring de /clients tal cual. Guardar los parametros y no una consulta
    -- propia evita que el segmento se desincronice de los filtros de la pantalla.
    "filters"         JSONB NOT NULL DEFAULT '{}',
    "created_by"      UUID,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "segments_organization_id_name_key"
    ON "segments" ("organization_id", "name");
CREATE INDEX IF NOT EXISTS "segments_organization_id_idx"
    ON "segments" ("organization_id");

ALTER TABLE "segments"
  ADD CONSTRAINT "segments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "segments"
  ADD CONSTRAINT "segments_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Misma politica que el resto: aislamiento por organizacion, resuelto con el subquery
-- de current_org_id(). Ver la migracion 20260824010000_rls.
ALTER TABLE "segments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY segments_tenant_isolation ON "segments"
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
