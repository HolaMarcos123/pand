-- Suspension de una organizacion desde la administracion de Pand.
--
-- Es una fecha y no un booleano a proposito: saber DESDE CUANDO esta suspendida
-- una cuenta es la primera pregunta cuando alguien llama a reclamar, y un
-- booleano obliga a ir a buscarla a los logs.
--
-- No se borra nada. La organizacion, su cartera y su historial quedan intactos:
-- suspender es cortar el acceso, no dar de baja.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMPTZ(6);

-- Indice parcial: las suspendidas son siempre unas pocas, y la consulta que
-- importa es "cuales estan suspendidas", no "cuales no".
CREATE INDEX IF NOT EXISTS "organizations_suspended_at_idx"
    ON "organizations" ("suspended_at")
 WHERE "suspended_at" IS NOT NULL;
