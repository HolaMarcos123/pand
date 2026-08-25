import { ShieldAlert } from "lucide-react";

export function Forbidden({ organizationName }: { organizationName: string }) {
  return (
    <div className="mx-auto max-w-md rounded-card border border-pand-border bg-white p-8 text-center shadow-card">
      <ShieldAlert className="mx-auto h-10 w-10 text-pand-coral" />
      <p className="mono mt-4 text-sm text-pand-gris">403</p>
      <h2 className="mt-1 text-xl font-bold">No tenés acceso a esta sección</h2>
      <p className="mt-2 text-sm text-pand-gris">
        La administración de la cuenta está reservada al rol Administrador. Pedile
        acceso a quien administre {organizationName}.
      </p>
    </div>
  );
}
