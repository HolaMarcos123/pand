import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * <select> nativo con la estética de shadcn/ui.
 *
 * Se usa este y no el Select de Radix en los formularios que disparan server
 * actions: Radix renderiza su input oculto vacío en el SSR y lo puebla al hidratar,
 * asi que si la hidratación falla o llega tarde, el campo viaja nulo y la validación
 * rebota sin que el usuario entienda por qué. El nativo ya viene con el valor puesto
 * en el HTML y funciona incluso sin JavaScript.
 *
 * Para selects que no van dentro de un form —filtros, menús— el de Radix sigue
 * siendo mejor, porque se puede estilar la lista desplegable.
 */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
      "ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
