import { resolve } from "node:path";

import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Las credenciales salen de .env.local, igual que la app y el seed.
loadEnv({ path: ".env.local", quiet: true });

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
