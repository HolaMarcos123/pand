import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7 no trae engine nativo: la conexion va por un driver adapter.
// Este cliente usa DATABASE_URL (pooler en modo transaccion, 6543), que es lo que
// corresponde para queries de la app. Las migraciones usan DIRECT_URL, no esto.
//
// Ojo con el alcance de RLS: el rol `postgres` tiene BYPASSRLS, asi que estas queries
// NO pasan por las policies. Toda consulta multi-tenant tiene que filtrar por
// organizationId explicitamente. Ver README → Base de datos.
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("Falta DATABASE_URL. Revisa .env.local");
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

// En dev, Next recarga los modulos en cada cambio. Sin este singleton cada recarga
// abriria un pool nuevo hasta agotar las conexiones de Supabase.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
