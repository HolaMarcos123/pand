import type { Metadata } from "next";

import { Forbidden } from "@/components/forbidden";
import { requireSession } from "@/lib/auth/session";

import { PaymentsWizard } from "./payments-wizard";

export const metadata: Metadata = {
  title: "Importar cobros",
};

export default async function ImportPaymentsPage() {
  const session = await requireSession();

  if (session.user.role === "OPERATOR") {
    return <Forbidden organizationName={session.organization.name} />;
  }

  return <PaymentsWizard currency={session.organization.currency} />;
}
