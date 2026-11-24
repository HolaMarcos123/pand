import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";

import "./globals.css";

/**
 * Geist para la interfaz y Geist Mono para las cifras.
 *
 * Por `next/font` y no por `@import` de Google Fonts, que es lo que había: un
 * `@import` en el CSS bloquea el renderizado hasta que vuelve la respuesta de
 * fonts.googleapis.com, y encima suma un dominio de terceros en cada visita.
 * Así las fuentes se descargan en el build, se sirven desde el mismo origen y
 * Next inyecta el `size-adjust` que evita el salto de layout al cargar.
 *
 * Las dos son variables: un solo archivo cubre de 100 a 900 y pesa menos que
 * los cuatro pesos estáticos que se pedían antes.
 */
const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

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
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
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
