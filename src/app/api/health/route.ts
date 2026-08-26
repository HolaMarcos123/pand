import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Diagnóstico de despliegue.
 *
 * En producción Next oculta los detalles de los errores de servidor —correcto, no
 * queremos filtrar stack traces— pero eso deja un 500 mudo cuando lo que falla es la
 * configuración del entorno. Este endpoint responde la única pregunta que importa en
 * ese momento: ¿qué variable falta y llega la base?
 *
 * Es público a propósito: si exigiera sesión no serviría, porque justamente cuando la
 * base no responde no se puede iniciar sesión.
 *
 * **Nunca devuelve valores.** Solo booleanos de presencia, y del error de base solo
 * el código de Prisma (P1000 = credenciales, P1001 = inalcanzable), que es
 * diagnóstico y no revela nada.
 */
export async function GET() {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    DIRECT_URL: Boolean(process.env.DIRECT_URL),
    // El valor sí se muestra: es NEXT_PUBLIC, viaja en el bundle, no es secreto.
    // Y es el que más se olvida apuntando a localhost.
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? null,
  };

  let database: { ok: boolean; code?: string; detail?: string };

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = { ok: true };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : undefined;

    database = {
      ok: false,
      code,
      // Solo se propaga el mensaje cuando es uno nuestro, que sabemos que no
      // contiene credenciales. Los de la librería podrían traer la cadena de
      // conexión.
      detail:
        error instanceof Error && error.message.startsWith("Falta DATABASE_URL")
          ? error.message
          : "Ver code y los Runtime Logs del deployment.",
    };
  }

  return NextResponse.json(
    { env, database },
    { status: database.ok ? 200 : 503 },
  );
}
