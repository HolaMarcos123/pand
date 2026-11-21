-- La deuda se identifica por deudor + OPERACION + cuota.
--
-- La migracion anterior hizo el numero de comprobante unico por deudor, porque
-- en un cuotero la cuota "1/60" la tienen todos los deudores. Faltaba un nivel:
-- un mismo deudor puede tener varios creditos a la vez, y cada uno numera sus
-- cuotas desde 1.
--
-- El caso real: un cliente de DIESA con un vehiculo en 60 cuotas financiado en
-- dolares, una moto en 36 cuotas en guaranies, y un segundo vehiculo en 48
-- cuotas en dolares. Las tres operaciones tienen una cuota "1/60", "1/36" y
-- "1/48", y dos de ellas podrian coincidir en numero. Sin la operacion en la
-- llave, esas cuotas son indistinguibles: o se mezclan dos deudas en una, o el
-- importador tiene que rechazar una cartera perfectamente valida.
--
-- Va como columna del comprobante y no como tabla propia a proposito. La
-- operacion no tiene todavia atributos que vivan solos: su moneda y su producto
-- ya viajan en cada cuota, igual que en la planilla de origen. Cuando haga
-- falta colgarle algo —la fecha de otorgamiento, el capital original, el
-- vendedor— esta columna es el punto de partida natural para una tabla.
--
-- NOT NULL con default '' y no nullable: en un indice unico Postgres considera
-- distintos a dos NULL, asi que con la columna nullable dos cuotas "1/60" del
-- mismo deudor sin operacion volverian a poder duplicarse. La cadena vacia es
-- un valor comparable y mantiene la proteccion para las carteras que no traen
-- numero de operacion.

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "loan_number" TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_org_client_loan_number_key"
    ON "invoices" ("organization_id", "client_id", "loan_number", "invoice_number");

-- Se borran las dos llaves anteriores con IF EXISTS porque cada base esta en un
-- punto distinto: la de prueba ya tiene la de (organizacion, deudor, numero) y
-- produccion todavia tiene la original de (organizacion, numero). Despues de
-- esto, las dos quedan igual.
DROP INDEX IF EXISTS "invoices_organization_id_client_id_invoice_number_key";
DROP INDEX IF EXISTS "invoices_organization_id_invoice_number_key";

-- El indice para agrupar las cuotas de una operacion en la ficha del deudor.
CREATE INDEX IF NOT EXISTS "invoices_client_id_loan_number_idx"
    ON "invoices" ("client_id", "loan_number")
 WHERE "loan_number" <> '';
