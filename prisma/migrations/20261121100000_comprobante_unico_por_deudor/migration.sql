-- El numero de comprobante es unico por DEUDOR, no por organizacion.
--
-- La llave anterior asumia que un numero de comprobante no se repite en toda la
-- organizacion. Eso vale para una factura fiscal, que lleva un numero unico por
-- emisor, pero no para un cuotero: en el cuotero de una financiera la columna
-- del comprobante es "1/60" —cuota 1 de 60— y TODOS los deudores tienen una
-- cuota 1/60. La cuota 1/60 de una persona y la de otra son dos deudas
-- distintas que comparten nombre.
--
-- Con la llave vieja, importar un cuotero colapsaba todas las cuotas que
-- compartian numero en un solo comprobante y se las atribuia al ultimo deudor
-- que aparecia en la planilla, porque el ON CONFLICT reasigna el client_id.
-- Paso con una cartera real el 21/11/2026: de unas 4.000 filas entraron 1.576
-- comprobantes, 2.696 deudores quedaron sin ninguna deuda, y los que
-- sobrevivieron quedaron colgados de la persona equivocada. La pantalla informo
-- que la carga habia salido bien.
--
-- La llave nueva es mas permisiva que la vieja, asi que todos los datos
-- existentes la cumplen: lo que era unico en la organizacion sigue siendo unico
-- dentro del deudor. Se crea antes de borrar la anterior para no quedar ni un
-- instante sin proteccion contra el doble cargado.

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_organization_id_client_id_invoice_number_key"
    ON "invoices" ("organization_id", "client_id", "invoice_number");

DROP INDEX IF EXISTS "invoices_organization_id_invoice_number_key";
