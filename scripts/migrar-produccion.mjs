// @ts-check
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import { config as loadEnv } from "dotenv";

/**
 * Aplica las migraciones pendientes contra PRODUCCIÓN, a mano.
 *
 * Normalmente no hace falta: el deploy de Vercel corre
 * `scripts/migrar-antes-del-build.mjs` en cada build. Esto es la salida de
 * emergencia —un deploy que no se puede hacer, una migración que hay que
 * aplicar antes— y por eso pide confirmación y dice a qué host se va a conectar.
 *
 * Existe como script y no como una línea de comando suelta porque la línea
 * tenía dos formas de salir mal: la sintaxis de variables de entorno cambia
 * entre PowerShell, cmd y bash, y había que estar parado en la carpeta correcta.
 */
const ARCHIVO = ".env.production.local";

if (!existsSync(ARCHIVO)) {
  console.error(
    `\n  ✗ No encuentro ${ARCHIVO}.\n\n` +
      "    Tiene que correrse desde la carpeta del proyecto (pand), y el\n" +
      "    archivo tiene que existir. Si se perdió:\n\n" +
      `      vercel env pull ${ARCHIVO} --environment=production\n`,
  );
  process.exit(1);
}

loadEnv({ path: ARCHIVO, quiet: true });

const url = process.env.DIRECT_URL;
if (!url) {
  console.error(`\n  ✗ ${ARCHIVO} no trae DIRECT_URL.\n`);
  process.exit(1);
}

// El host, sin la contraseña: alcanza para saber adónde apunta y no deja la
// credencial en el historial de la terminal.
const host = url.replace(/^.*@/, "").replace(/\?.*$/, "");

console.log(
  `\n  ⚠ Esto aplica migraciones en PRODUCCIÓN.\n` +
    `    Base: ${host}\n` +
    `    La usan los clientes ahora mismo.\n`,
);

if (!process.argv.includes("--si")) {
  const consola = createInterface({ input: process.stdin, output: process.stdout });
  const respuesta = (await consola.question("  ¿Seguir? (escribí SI) ")).trim();
  consola.close();

  if (respuesta !== "SI") {
    console.log("\n  Cancelado. No se tocó nada.\n");
    process.exit(0);
  }
}

// PAND_DB lo lee prisma.config.ts para elegir el archivo de entorno.
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, PAND_DB: "prod" },
  // En Windows `npx` es un .cmd y sin shell no se encuentra.
  shell: process.platform === "win32",
});

process.exit(r.status ?? 1);
