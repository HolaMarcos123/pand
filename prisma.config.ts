import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// .env.local es DESARROLLO y es lo que se usa siempre, salvo que alguien pida
// produccion a proposito con PAND_DB=prod. Que haya que escribirlo es el punto:
// una migracion contra la base de los clientes no puede salir de un descuido.
//
//   npm.cmd run db:deploy:prod   (scripts/migrar-produccion.mjs lo pone)
//
// Ojo: `import "dotenv/config"` cargaria .env, no .env.local — de ahi el path
// explicito.
const archivo =
  process.env.PAND_DB === "prod" ? ".env.production.local" : ".env.local";

loadEnv({ path: archivo });

if (process.env.PAND_DB === "prod") {
  console.warn("\n  ⚠ PAND_DB=prod: esto apunta a la base de PRODUCCION.\n");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // DIRECT_URL, no DATABASE_URL, y es a proposito.
    //
    // Este archivo lo lee unicamente el CLI (migrate, db execute, studio), que
    // necesita una conexion en modo sesion: el pooler de transaccion no soporta
    // los locks ni los prepared statements que usa migrate, y el comando se cuelga
    // sin devolver error.
    //
    // La app en runtime NO pasa por aca: usa DATABASE_URL (pooler 6543) a traves
    // del driver adapter en src/lib/prisma.ts.
    //
    // `directUrl` existe en la documentacion de Prisma 7 pero no en los tipos de
    // 7.9.1: ponerlo ahi no hace nada, se ignora en silencio.
    //
    // Se lee con process.env y NO con el helper env() de Prisma, a proposito.
    // env() tira PrismaConfigEnvError si la variable no existe, y eso rompe
    // `prisma generate` —que solo genera codigo y no toca la base— en cualquier
    // entorno donde la URL no este definida. Rompio el build de Vercel.
    // Asi, generate siempre funciona y solo migrate falla si falta la conexion,
    // que es cuando de verdad hace falta.
    url: process.env.DIRECT_URL,
  },
});
