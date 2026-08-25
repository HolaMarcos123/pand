-- Llave anti doble-cobro para el importador de cobros.
--
-- Postgres permite varios NULL dentro de un indice unico, asi que los cobros que no
-- traen referencia siguen pudiendo cargarse; solo se deduplican los que si la traen.
-- Sin esto, subir dos veces la misma planilla de cobros duplica la plata cobrada y
-- deja facturas pagadas que en realidad no lo estan.
--
-- Escrita a mano y no con `migrate diff`: el diff compara contra el schema de Prisma,
-- que no conoce las policies de RLS, los triggers ni las funciones, y los mandaria a
-- DROP.
CREATE UNIQUE INDEX "payments_organization_id_reference_key"
    ON "payments" ("organization_id", "reference");
