import { createBrowserClient } from "@supabase/ssr";

// Cliente de Supabase para Client Components. Usa la anon key, que es publica por
// diseno: lo que protege los datos son las policies de RLS, no esta clave.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
