// @ts-check
import { spawnSync } from "node:child_process";

import { config as loadEnv } from "dotenv";

// El mismo archivo que lee prisma.config.ts, y por la misma razón: en Vercel
// las variables llegan del entorno y esto no encuentra nada que cargar, pero en
// una notebook viven acá. Sin esto el guard de abajo daba "no hay base" aunque
// Prisma sí hubiera podido conectarse, y `npm run build` local no migraba nada.
loadEnv({ path: ".env.local", quiet: true });

/**
 * Aplica las migraciones pendientes antes de compilar, en el deploy.
 *
 * Por qué acá y no a mano desde una notebook: desde que la base de desarrollo
 * es otra, la máquina de nadie tiene las credenciales de producción a mano —y
 * esa es justamente la idea. Si las migraciones no corren en el deploy, el
 * código nuevo sale a producción contra un esquema viejo y la pantalla se rompe
 * para los clientes.
 *
 * Si no hay conexión configurada, no se migra y el build sigue. `next build`
 * tiene que poder correr en una máquina sin base —un chequeo local, un CI que
 * solo compila— y romperlo ahí no protege nada: lo que importa es que en Vercel
 * la variable SÍ está, y entonces esto corre de verdad.
 *
 * Un fallo de migración sí corta el build. Es lo correcto: desplegar código que
 * espera una columna que no existe es peor que no desplegar.
 */
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.log(
    "\n  ℹ Sin DIRECT_URL: no se migra nada y el build sigue.\n" +
      "    En Vercel la variable está, así que ahí sí corre.\n",
  );
  process.exit(0);
}

console.log("\n  → Aplicando migraciones pendientes…\n");

const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  // En Windows `npx` es un .cmd y sin shell no se encuentra.
  shell: process.platform === "win32",
});

process.exit(r.status ?? 1);
