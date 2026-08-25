"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
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
export function UsersTable({ users }: { users: UserRow[] }) {
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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
