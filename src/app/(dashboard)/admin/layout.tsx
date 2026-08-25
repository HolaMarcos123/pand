import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";

/**
 * Compuerta visual de /admin/*. Muestra un 403 con explicación en vez de un redirect
 * mudo, que parecería que la app se rompió.
 *
 * OJO — ESTO NO ALCANZA PARA PROTEGER DATOS, y no es un detalle teórico.
 *
 * Next renderiza el layout y la página EN PARALELO. Que este layout devuelva el 403
 * en lugar de `{children}` evita que la página se vea, pero la página igual se
 * ejecutó: consultó la base y su resultado quedó serializado en el flight payload de
 * RSC que viaja dentro del HTML. Un operador que abría /admin/users veía el 403 en
 * pantalla y tenía la lista completa de usuarios —nombres, emails, roles, ids— en el
 * código fuente.
 *
 * Por eso cada página bajo /admin valida el rol POR SU CUENTA y antes de tocar la
 * base. Este layout es la capa de presentación; la autorización real vive en la
 * página. Si agregás una pantalla acá, tenés que repetir el chequeo.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  if (session.user.role !== "ADMIN") {
    return <Forbidden organizationName={session.organization.name} />;
  }

  return <>{children}</>;
}
