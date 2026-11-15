import { Prisma } from "@/generated/prisma/client";

import { TRAMOS } from "@/lib/collections/tramos";

/**
 * Las expresiones SQL de los tramos, separadas del catálogo.
 *
 * El corte no es estético: `Prisma.sql` es código de servidor y arrastra `node:module`.
 * Con todo en un archivo, un componente cliente que solo quería las etiquetas se
 * llevaba el cliente de Prisma al bundle del browser y el build de Turbopack se caía.
 * Las etiquetas y la clasificación viven en `collections/tramos`, que no importa nada.
 */

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

/**
 * `tramoCliente` como expresión SQL, para poder filtrar en la base.
 *
 * Sale de la misma tabla de límites que la función de TypeScript: si el filtro y la
 * columna que muestra el tramo se calcularan por separado, filtrar por "61-90"
 * devolvería filas que la tabla dibuja en otro tramo.
 */
export function tramoClienteSql(
  diasCol: Prisma.Sql,
  abiertosCol: Prisma.Sql,
  castigadosCol: Prisma.Sql,
): Prisma.Sql {
  return Prisma.sql`CASE
    WHEN COALESCE(${abiertosCol}, 0) = 0
      THEN CASE WHEN COALESCE(${castigadosCol}, 0) > 0 THEN 'CASTIGO' ELSE 'AL_DIA' END
    ELSE ${tramoSql(Prisma.sql`COALESCE(${diasCol}, 0)`, Prisma.raw("'PENDING'"))}
  END`;
}
