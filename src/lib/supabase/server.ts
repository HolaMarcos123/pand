import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

// Cliente de Supabase para Server Components, Server Actions y Route Handlers.
//
// Async desde Next 15: cookies() dejo de ser sincrono porque el request se resuelve
// despues de empezar a renderizar. Por eso todos los llamadores la esperan.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Los Server Components no pueden escribir cookies. Se ignora a proposito:
            // el middleware ya refresco la sesion antes de llegar aca.
          }
        },
      },
    },
  );
}
