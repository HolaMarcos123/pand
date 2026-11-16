import { describe, expect, it } from "vitest";
import { z } from "zod";

import { idSchema } from "@/lib/validation/id";

/**
 * Validar un id más estricto que la base rechaza filas legítimas.
 *
 * Bug real: suspender una organización desde el backoffice fallaba con "Datos
 * inválidos" y nada más. El id era `44444444-...`, que Postgres guarda sin
 * problema pero que no cumple los bits de versión y variante de la RFC 4122.
 */

describe("idSchema", () => {
  const validos = [
    // UUID v4 canónico, el caso normal.
    "7d56c5fc-6456-426e-a58d-b7f6d074c8bf",
    // El de la organización que destapó el bug: variante inválida para la RFC,
    // perfectamente válido para Postgres.
    "44444444-4444-4444-4444-444444444444",
    // Todo ceros, que es lo que suele quedar de una migración vieja.
    "00000000-0000-0000-0000-000000000000",
    // Hexadecimal en mayúsculas.
    "7D56C5FC-6456-426E-A58D-B7F6D074C8BF",
  ];

  it.each(validos)("acepta %s, igual que Postgres", (id) => {
    expect(idSchema.safeParse(id).success).toBe(true);
  });

  const invalidos = [
    "",
    "no-es-un-uuid",
    // Le falta un grupo.
    "7d56c5fc-6456-426e-a58d",
    // Tiene una letra fuera del hexadecimal.
    "7d56c5fc-6456-426e-a58d-b7f6d074c8bz",
    // Sin guiones: Postgres lo aceptaría, pero no es el formato que generamos y
    // aceptarlo permitiría que el mismo id se escriba de dos maneras.
    "7d56c5fc6456426ea58db7f6d074c8bf",
    "' OR 1=1 --",
  ];

  it.each(invalidos)("rechaza %s", (id) => {
    expect(idSchema.safeParse(id).success).toBe(false);
  });

  it("es más permisivo que el uuid estricto de Zod, a propósito", () => {
    // Si algún día Zod cambia y los dos empiezan a coincidir, este test avisa:
    // querría decir que volvimos a validar más estricto que la base.
    const estricto = z.string().uuid();
    expect(estricto.safeParse("44444444-4444-4444-4444-444444444444").success).toBe(false);
    expect(idSchema.safeParse("44444444-4444-4444-4444-444444444444").success).toBe(true);
  });
});
