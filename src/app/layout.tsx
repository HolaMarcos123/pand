import type { Metadata } from "next";
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
      </body>
    </html>
  );
}
