import { getSession, type SessionData } from "@/lib/auth/session";

/**
 * Quién puede entrar al backoffice de Pand.
 *
 * Es el permiso más alto que existe en el producto: ve y modifica los datos de
 * TODAS las empresas clientes. Por eso no vive en la base.
 *
 * La alternativa natural —una columna `users.is_platform_admin` o una tabla de
 * administradores— tiene un problema que pesa más que su comodidad: convierte
 * cualquier agujero de escritura sobre usuarios en una escalada a dios. Si algún
 * día una acción deja que un ADMIN de una empresa toque su propia fila de
 * `users`, con una columna booleana eso termina en acceso a la cartera de todos
 * los demás clientes. Con una lista en variables de entorno, escalar exige
 * entrar a Vercel y desplegar, que es un sistema distinto y mucho mejor
 * protegido.
 *
 * El segundo motivo es que no hace falta una pantalla para administrar
 * administradores, y esa pantalla también sería una superficie de escalada.
 *
 * El costo: sumar a alguien requiere cambiar una variable y redesplegar. Para
 * algo que pasa una vez por año, es el costo correcto.
 *
 * Formato: emails separados por coma en PLATFORM_ADMIN_EMAILS.
 */
function allowlist(): Set<string> {
  return new Set(
    (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Si la variable está vacía, NADIE es administrador de plataforma.
 *
 * El default es cerrado a propósito: un despliegue donde se olvidaron de
 * configurarla deja el backoffice inaccesible, que es molesto pero seguro. Al
 * revés —una lista vacía que deja pasar a todos— sería una catástrofe silenciosa.
 */
export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowlist().has(email.trim().toLowerCase());
}

export type PlatformSession = SessionData & { isPlatformAdmin: true };

/**
 * Sesión de alguien que puede operar el backoffice, o `null`.
 *
 * Devuelve null en vez de redirigir para que cada pantalla decida qué mostrar.
 * El backoffice responde 404 y no 403: a quien no es administrador de plataforma
 * no se le confirma siquiera que estas rutas existen.
 */
export async function getPlatformSession(): Promise<PlatformSession | null> {
  const session = await getSession();
  if (!session || !isPlatformAdmin(session.user.email)) return null;
  return { ...session, isPlatformAdmin: true };
}
