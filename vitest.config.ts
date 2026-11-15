import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Tests de lógica pura: corren sin base de datos y sin red.
 *
 * Son los que corre CI en cada push, por eso tienen que ser rápidos y no depender
 * de nada externo. Los que sí tocan la base viven en tests/db y usan
 * `vitest.db.config.ts`, porque necesitan credenciales y tardan segundos, no
 * milisegundos.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
