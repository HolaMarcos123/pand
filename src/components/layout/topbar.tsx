"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bell, Search } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { titleForPath } from "@/lib/nav";

export function Topbar() {
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Cmd+K en Mac, Ctrl+K en Windows y Linux.
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-pand-border bg-white px-6">
        <h1 className="flex-1 text-base font-bold">{titleForPath(pathname)}</h1>

        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 rounded-md border border-pand-border bg-pand-bg px-3 py-1.5 text-sm text-pand-gris transition-colors hover:border-pand-celeste"
        >
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Buscar</span>
          <kbd className="mono ml-2 hidden rounded border border-pand-border bg-white px-1.5 py-0.5 text-[11px] sm:inline">
            ⌘K
          </kbd>
        </button>

        {/* Sin badge: no hay modelo de notificaciones todavía. Un contador inventado
            acá enseñaría a ignorarlo justo cuando empiece a ser real (P09). */}
        <button
          type="button"
          title="Las notificaciones llegan en el paso P09"
          className="rounded-md p-2 text-pand-gris transition-colors hover:text-pand-contorno"
        >
          <Bell className="h-5 w-5" />
        </button>

        {/* Avatar de la cuenta: isologo CON cuadrado celeste, como pide el manual.
            El SVG del kit trae el cuadrado en #F6F8FB, así que el celeste lo pone
            el contenedor. */}
        <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-pand-celeste">
          <Image
            src="/brand/isologo.svg"
            alt="Cuenta"
            width={512}
            height={512}
            className="h-9 w-9 mix-blend-multiply"
          />
        </span>
      </header>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buscador global</DialogTitle>
            <DialogDescription>
              Busca clientes, facturas y gestiones desde cualquier pantalla.
            </DialogDescription>
          </DialogHeader>

          <Input placeholder="Nombre, documento o número de factura…" disabled />

          <p className="text-xs text-pand-gris">
            El buscador se conecta cuando existan clientes y carteras que buscar
            (pasos P04 y P05). El atajo ya funciona.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
