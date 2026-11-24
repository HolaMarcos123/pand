-- Tipificaciones propias de cada organizacion.
--
-- Hasta ahora una organizacion podia renombrar y apagar las tipificaciones de
-- fabrica, pero no crear ninguna: el tipo y el resultado de una gestion son
-- enums de Postgres, y agregarle un valor por organizacion no se puede.
--
-- La salida es separar el **nombre** de la **semantica**. Cada tipificacion
-- propia vive en organizations.settings (es vocabulario, no algo que se cruce en
-- SQL) y declara de que valor de fabrica hereda el significado. La gestion sigue
-- guardando el enum en action_type / result —de ahi salen el reporte de promesas
-- y la contactabilidad, y siguen funcionando sin tocarlos— y ademas guarda en
-- estas dos columnas CUAL de las tipificaciones de la organizacion se eligio.
--
-- Ejemplo: "Carta documento" hereda de EMAIL. La gestion queda con
-- action_type = 'EMAIL' y type_code = 'carta_documento'. El reporte de
-- efectividad por canal la cuenta como email, que es lo correcto, y la ficha del
-- deudor muestra "Carta documento", que es lo que cargo el operador.
--
-- TEXT y nullable, no un enum y no NOT NULL: el codigo es un slug que define la
-- organizacion en su JSON de configuracion, asi que la base no tiene de donde
-- validarlo, y las gestiones cargadas antes de esta migracion no tienen ninguno
-- —NULL ahi significa "se uso la tipificacion de fabrica", que es la verdad.

ALTER TABLE "management_actions"
  ADD COLUMN IF NOT EXISTS "type_code"   TEXT,
  ADD COLUMN IF NOT EXISTS "result_code" TEXT;

COMMENT ON COLUMN "management_actions"."type_code" IS
  'Slug de la tipificacion de tipo elegida, de organizations.settings. NULL = la de fabrica de action_type.';

COMMENT ON COLUMN "management_actions"."result_code" IS
  'Slug de la tipificacion de resultado elegida, de organizations.settings. NULL = la de fabrica de result.';
