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
    throw new Error(
      "Falta DATABASE_URL. En local va en .env.local; en Vercel, en " +
        "Settings → Environment Variables del proyecto.",
    );
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

function getPrismaClient() {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * El cliente se crea en el **primer uso real**, no al importar el modulo.
 *
 * Esto no es una optimizacion, es lo que permite que el build funcione. Durante
 * `next build`, Next importa cada pagina para recolectar su configuracion; si el
 * cliente se instanciara al importar, el build entero dependeria de tener
 * DATABASE_URL disponible en tiempo de compilacion, y moria con
 * "Failed to collect page data for /overview" aunque no ejecute una sola consulta.
 *
 * Con el proxy, construir y consultar quedan separados: el build no necesita
 * credenciales, y si falta la variable el error aparece en la primera query, en
 * runtime, con el mismo mensaje claro de siempre.
 */
export const prisma = new Proxy({} as ReturnType<typeof createPrismaClient>, {
  get(_target, property) {
    const client = getPrismaClient();
    const value = Reflect.get(client as object, property, client);
    // Los metodos (`$transaction`, `$queryRaw`…) se devuelven atados al cliente:
    // sueltos perderian el `this` y fallarian al invocarlos.
    return typeof value === "function" ? value.bind(client) : value;
  },
});
