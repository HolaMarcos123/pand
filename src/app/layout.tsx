import type { Metadata } from "next";
import { Toaster } from "sonner";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pand",
    template: "%s · Pand",
  },
  description: "Software de cobranzas para equipos que persiguen menos y cobran mejor.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-pand-bg font-sans text-pand-contorno antialiased">
        {children}
        {/* Feedback de las server actions. richColors usa verde/rojo propios de
            sonner en vez de la paleta Pand: los toasts son efímeros y conviene que
            se lean distinto al resto de la UI. */}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
