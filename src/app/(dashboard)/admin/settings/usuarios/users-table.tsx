"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Loader2, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createSortedRowModel,
  rowSortingFeature,
  useTable,
} from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelative } from "@/lib/format";
import {
  desactivarUsuario,
  eliminarUsuario,
  reactivarUsuario,
} from "@/lib/users/actions";
import type { Role } from "@/generated/prisma/enums";

export type UserRow = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  lastLoginAt: string | null;
};

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  SUPERVISOR: "Supervisor",
  OPERATOR: "Operador",
};

/**
 * Color por rol. El azul de marca marca el rol con más poder; los otros dos van en
 * neutros para no competir.
 */
const ROLE_CLASSES: Record<Role, string> = {
  ADMIN: "bg-pand-azul text-white hover:bg-pand-azul",
  SUPERVISOR: "bg-pand-celeste text-pand-contorno hover:bg-pand-celeste",
  OPERATOR: "bg-pand-border text-pand-gris hover:bg-pand-border",
};

/**
 * TanStack Table v9. Ojo: la v9 cambió la API respecto de la v8 que documenta casi
 * todo lo que hay dando vueltas. Ya no existe `useReactTable` ni se pasan
 * `getCoreRowModel()` como opciones sueltas: se usa `useTable` y las capacidades
 * entran por `features`, donde también viven las fábricas de row models. El core
 * viene por defecto; el ordenamiento hay que pedirlo.
 */
export function UsersTable({
  users,
  usuarioActualId,
}: {
  users: UserRow[];
  /** Para no ofrecerle a nadie la opción de dejarse afuera a sí mismo. */
  usuarioActualId: string;
}) {
  const [trabajando, startTransition] = useTransition();
  const [confirmando, setConfirmando] = useState<string | null>(null);

  function cambiarEstado(user: UserRow) {
    startTransition(async () => {
      const outcome = user.isActive
        ? await desactivarUsuario({ userId: user.id })
        : await reactivarUsuario({ userId: user.id });

      if (!outcome.ok) {
        toast.error(outcome.error);
        return;
      }
      toast.success(
        user.isActive
          ? `${user.fullName} ya no puede entrar. Se liberó su asiento.`
          : `${user.fullName} puede volver a entrar.`,
      );
    });
  }

  function eliminar(user: UserRow) {
    startTransition(async () => {
      const outcome = await eliminarUsuario({ userId: user.id });
      setConfirmando(null);

      if (!outcome.ok) {
        // El mensaje explica por qué no se puede y qué hacer en su lugar, así
        // que conviene que se quede en pantalla más que un toast corto.
        toast.error(outcome.error, { duration: 10_000 });
        return;
      }

      toast.success(
        outcome.desasignados > 0
          ? `${user.fullName} eliminado. Sus ${outcome.desasignados} deudores quedaron sin asignar.`
          : `${user.fullName} eliminado. Su email queda libre para invitarlo de nuevo.`,
      );
    });
  }

  const table = useTable({
    features: {
      rowSortingFeature,
      sortedRowModel: createSortedRowModel(),
    },
    data: users,
    columns: [
      { accessorKey: "fullName", header: "Nombre" },
      { accessorKey: "email", header: "Email" },
      { accessorKey: "role", header: "Rol" },
      { accessorKey: "isActive", header: "Estado" },
      { accessorKey: "lastLoginAt", header: "Última conexión" },
      { id: "acciones", header: "" },
    ],
  });

  return (
    <div className="overflow-x-auto rounded-card bg-white shadow-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();

                return (
                  <TableHead key={header.id}>
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="flex items-center gap-1 font-semibold hover:text-pand-contorno"
                    >
                      <table.FlexRender header={header} />
                      {sorted === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.map((row, index) => {
            const user = row.original;

            return (
              <TableRow
                key={row.id}
                className={index % 2 === 1 ? "bg-pand-bg" : undefined}
              >
                <TableCell className="font-semibold">{user.fullName}</TableCell>
                <TableCell className="text-pand-gris">{user.email}</TableCell>
                <TableCell>
                  <Badge className={ROLE_CLASSES[user.role]}>
                    {ROLE_LABELS[user.role]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.isActive ? (
                    <span className="text-sm text-pand-gris">Activo</span>
                  ) : (
                    <span className="text-sm font-semibold text-pand-coral">
                      Inactivo
                    </span>
                  )}
                </TableCell>
                <TableCell className="mono text-sm text-pand-gris">
                  {formatRelative(user.lastLoginAt)}
                </TableCell>

                <TableCell className="text-right">
                  {user.id === usuarioActualId ? (
                    <span className="text-xs text-pand-gris">Sos vos</span>
                  ) : confirmando === user.id ? (
                    <span className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <span className="text-xs text-pand-coral">
                        ¿Eliminar definitivamente?
                      </span>
                      <button
                        type="button"
                        disabled={trabajando}
                        onClick={() => eliminar(user)}
                        className="rounded-md bg-pand-coral px-2.5 py-1 text-xs font-semibold text-white"
                      >
                        Sí
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmando(null)}
                        className="text-xs text-pand-gris hover:text-pand-contorno"
                      >
                        No
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        disabled={trabajando}
                        title={
                          user.isActive
                            ? "Desactivar: deja de entrar, se conserva su historial"
                            : "Reactivar"
                        }
                        onClick={() => cambiarEstado(user)}
                        className="rounded-md p-1.5 text-pand-gris transition-colors hover:bg-pand-bg hover:text-pand-contorno"
                      >
                        {trabajando ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : user.isActive ? (
                          <UserMinus className="h-4 w-4" />
                        ) : (
                          <UserPlus className="h-4 w-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={trabajando}
                        title="Eliminar: solo si no registró gestiones ni cobros. Libera el email."
                        onClick={() => setConfirmando(user.id)}
                        className="rounded-md p-1.5 text-pand-gris transition-colors hover:bg-pand-bg hover:text-pand-coral"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
