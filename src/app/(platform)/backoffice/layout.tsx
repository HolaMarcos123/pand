import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { getPlatformSession } from "@/lib/platform/access";

/**
 * Shell del backoffice de Pand.
 *
 * Dos decisiones deliberadas:
 *
 * 1. **404 y no 403.** A quien no es administrador de plataforma no se le
 *    confirma siquiera que estas rutas existen. Un 403 le dice "acá hay algo
 *    que no podés ver", que es justo la pista que no queremos dar.
 *
 * 2. **No se parece al producto.** Fondo oscuro y una franja que dice de quién
 *    son los datos que se están mirando. Acá se ve la cartera de TODOS los
 *    clientes a la vez, y confundir esta pantalla con la de una empresa sería
 *    el peor error posible: el que termina con alguien tocando los datos del
 *    cliente equivocado.
 *
 * El corte va igual en cada página, porque el layout y la página se renderizan
 * en paralelo y un corte acá no evita que la página consulte.
 */
export default async function BackofficeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getPlatformSession();
  if (!session) notFound();

  return (
    <div className="min-h-screen bg-pand-contorno">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href="/backoffice" className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-pand-celeste" />
            <span className="font-bold text-white">Pand · Backoffice</span>
          </Link>

          <span className="rounded-badge bg-pand-coral px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            Todas las empresas
          </span>

          <div className="flex-1" />

          <span className="text-xs text-pand-gris">{session.user.email}</span>

          <Link
            href="/overview"
            className="rounded-badge border border-white/20 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10"
          >
            Volver al producto
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  );
}
