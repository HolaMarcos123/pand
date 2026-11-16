import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Las credenciales salen de .env.local, igual que la app y el seed.
loadEnv({ path: ".env.local", quiet: true });

/**
 * Los tests corren contra TEST_DATABASE_URL si está definida.
 *
 * Es para poder apuntarlos a un proyecto de Supabase que no sea el de producción.
 * Los tests limpian lo suyo —cada uno crea su organización y la borra—, pero la
 * red de seguridad del producto no debería escribir en la base de los clientes
 * para hacer su trabajo.
 *
 * Si no está definida, caen a DATABASE_URL y lo avisan. Es preferible correrlos
 * contra la base de desarrollo que no correrlos, pero conviene que se vea.
 */
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
} else {
  console.warn(
    "\n  ⚠ Sin TEST_DATABASE_URL: los tests van a correr contra DATABASE_URL.\n" +
      "    Definila en .env.local para apuntarlos a la base de pruebas.\n",
  );
}

/**
 * Tests contra la base real.
 *
 * Cada uno se crea su propia organización con un nombre único y la borra al
 * terminar, así que no tocan la demo ni ninguna cartera de verdad, y se pueden
 * correr las veces que haga falta sin dejar basura.
 *
 * Van en serie (un solo hilo): comparten la misma base, y correrlos en paralelo
 * convierte un fallo en un misterio.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    // São Paulo está lejos: un test que arma una cartera hace varias vueltas.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
