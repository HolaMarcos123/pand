import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con la clave secreta del proyecto. Ignora RLS por completo, asi que
 * solo puede usarse en el servidor y nunca en un Client Component.
 *
 * Hace falta para las operaciones de admin de Auth (invitar usuarios, por
 * ejemplo), que la anon key no puede hacer.
 *
 * Sirven las dos claves que da Supabase: la nueva `sb_secret_...` y la vieja
 * `service_role` (un JWT). La variable se sigue llamando SERVICE_ROLE por
 * compatibilidad con lo que ya esta cargado en Vercel. Para proyectos nuevos
 * conviene la nueva: las legacy se retiran a principios de 2027 y se rotan por
 * separado, asi que quemar una no obliga a rotar la otra.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY en .env.local. Se saca del dashboard: " +
        "Project Settings → API Keys → Secret keys → el ojito para revelarla " +
        "(empieza con sb_secret_). Las viejas service_role siguen andando y " +
        "estan en «View legacy API keys».",
    );
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
