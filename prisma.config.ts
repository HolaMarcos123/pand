import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Unica fuente de verdad para secretos: .env.local (gitignorado).
loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
