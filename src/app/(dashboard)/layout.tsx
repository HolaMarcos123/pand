import { redirect } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { requireSession } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/access";
import { getTaskCount } from "@/lib/queries/dashboard";

/**
 * Shell del producto: sidebar fijo, header y área de contenido.
 *
 * El onboarding vive en su propio route group y no acá, para que este redirect no
 * se muerda la cola.
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

  const taskCount = await getTaskCount(session.organization.id, session.user.id);

  return (
    <AuthProvider session={session}>
      <div className="flex min-h-screen">
        <Sidebar
          taskCount={taskCount}
          esAdminDePlataforma={isPlatformAdmin(session.user.email)}
        />

        {/* min-w-0 para que una tabla ancha scrollee dentro del área y no empuje
            el layout entero hacia la derecha. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 bg-pand-bg p-6">{children}</main>
        </div>
      </div>
    </AuthProvider>
  );
}
