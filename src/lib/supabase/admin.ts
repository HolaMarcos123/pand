import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con service_role. Ignora RLS por completo, asi que solo puede usarse en el
 * servidor y nunca en un Client Component.
 *
 * Hace falta para las operaciones de admin de Auth (invitar usuarios, por ejemplo),
 * que la anon key no puede hacer.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY en .env.local. " +
        "Se saca del dashboard: Project Settings → API Keys → service_role → Reveal.",
    );
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
