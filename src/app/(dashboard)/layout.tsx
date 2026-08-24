import { redirect } from "next/navigation";

import { AuthProvider } from "@/lib/auth/auth-provider";
import { requireSession } from "@/lib/auth/session";

/**
 * Layout de las pantallas con sesion. El sidebar y el header del producto llegan en
 * el P03; por ahora esto resuelve la sesion una sola vez y la baja al arbol.
 *
 * El onboarding vive en su propio route group y no bajo este layout, justamente para
 * que este redirect no se muerda la cola.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  if (!session.organization.isOnboarded) {
    redirect("/onboarding");
  }

  return <AuthProvider session={session}>{children}</AuthProvider>;
}
