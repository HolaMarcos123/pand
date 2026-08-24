import { type NextRequest, NextResponse } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Rutas publicas. Todo lo demas exige sesion.
 *
 * El brief dice "protege /dashboard/*", pero los route groups de Next —`(dashboard)`—
 * no agregan segmento a la URL: `app/(dashboard)/overview/page.tsx` se sirve en
 * `/overview`, no en `/dashboard/overview`. Un matcher sobre /dashboard no protegeria
 * nada. Por eso la lista es al reves: se enumera lo publico y el resto queda cerrado
 * por defecto, que ademas falla del lado seguro cuando alguien agrega una pantalla
 * nueva y se olvida del middleware.
 */
const PUBLIC_ROUTES = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/pricing",
  "/demo",
];

function isPublic(pathname: string) {
  if (PUBLIC_ROUTES.includes(pathname)) return true;
  // Los webhooks entrantes (P06) se autentican con su propio token, no con sesion.
  if (pathname.startsWith("/api/webhooks/")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { supabase, user, response } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Sin sesion en ruta privada → al login, recordando a donde queria ir.
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(url);
  }

  // Con sesion en login/register → adentro.
  if (user && (pathname === "/login" || pathname === "/register")) {
    const url = request.nextUrl.clone();
    url.pathname = "/overview";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // X-Org-Id para las rutas privadas, como pide el brief.
  //
  // Cuesta un roundtrip a PostgREST por request. Se banca porque la consulta pega
  // sobre la PK de `users` y RLS la limita a la propia fila, pero si el dashboard
  // llega a sentirlo, la salida es mover organization_id a un claim del JWT con un
  // custom access token hook y leerlo de la sesion sin tocar la base.
  if (user && !isPublic(pathname)) {
    const { data } = await supabase
      .from("users")
      .select("organization_id")
      .eq("id", user.id)
      .maybeSingle();

    if (data?.organization_id) {
      response.headers.set("X-Org-Id", data.organization_id);
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todo menos assets estaticos y archivos con extension. Sin esto el middleware
     * correria en cada imagen y cada chunk de JS.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
