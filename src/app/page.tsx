import Image from "next/image";
import { ArrowUpRight, Clock, TriangleAlert, Wallet } from "lucide-react";

import logo from "../../public/brand/logo.png";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const kpis = [
  { label: "Cartera vigente", value: "$ 4.812.400", icon: Wallet, tone: "celeste" },
  { label: "Por vencer (7 d)", value: "$ 963.120", icon: Clock, tone: "celeste" },
  { label: "En mora", value: "$ 1.204.980", icon: TriangleAlert, tone: "coral" },
] as const;

const cuentas = [
  { cliente: "Distribuidora Norte SRL", factura: "A-0004-00019283", monto: "$ 412.300", dias: 0 },
  { cliente: "Metalúrgica Paraná SA", factura: "A-0004-00019301", monto: "$ 128.750", dias: 12 },
  { cliente: "Agro Insumos del Litoral", factura: "B-0002-00007744", monto: "$ 664.930", dias: 47 },
];

const tokens = [
  { nombre: "celeste", hex: "#7BE1FF", clase: "bg-pand-celeste" },
  { nombre: "azul", hex: "#006AFF", clase: "bg-pand-azul" },
  { nombre: "contorno", hex: "#2A2A35", clase: "bg-pand-contorno" },
  { nombre: "gris", hex: "#6E6E78", clase: "bg-pand-gris" },
  { nombre: "coral", hex: "#F4707C", clase: "bg-pand-coral" },
  { nombre: "bg", hex: "#F6F8FB", clase: "bg-pand-bg" },
  { nombre: "border", hex: "#E6E9EE", clase: "bg-pand-border" },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-center justify-between">
        <Image src={logo} alt="Pand" priority className="h-9 w-auto" />
        <Button>
          Nueva gestión
          <ArrowUpRight className="ml-1 h-4 w-4" />
        </Button>
      </header>

      <Separator className="my-8" />

      <h1 className="text-3xl font-extrabold tracking-tight">
        Cobrá antes, sin perseguir a nadie.
      </h1>
      <p className="mt-2 max-w-xl text-pand-gris">
        Design system activo. Esta pantalla existe para verificar los tokens; se
        reemplaza cuando arranque el dashboard real.
      </p>

      <section className="mt-8 grid gap-4 sm:grid-cols-3">
        {kpis.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-semibold text-pand-gris">
                {label}
              </CardTitle>
              <span
                className={
                  tone === "coral"
                    ? "rounded-lg bg-pand-coral/15 p-2 text-pand-coral"
                    : "rounded-lg bg-pand-celeste/30 p-2 text-pand-azul"
                }
              >
                <Icon className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              <p
                className={`mono text-2xl font-medium ${
                  tone === "coral" ? "text-pand-coral" : "text-pand-contorno"
                }`}
              >
                {value}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base font-bold">Cuentas a gestionar</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Comprobante</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead className="text-right">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cuentas.map((c) => (
                <TableRow key={c.factura}>
                  <TableCell className="font-semibold">{c.cliente}</TableCell>
                  <TableCell className="mono text-pand-gris">{c.factura}</TableCell>
                  <TableCell className="mono text-right">{c.monto}</TableCell>
                  <TableCell className="text-right">
                    {c.dias === 0 ? (
                      <Badge variant="secondary">Al día</Badge>
                    ) : (
                      <span className="mono text-sm font-medium text-pand-coral">
                        {c.dias} d de mora
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base font-bold">Tokens</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {tokens.map((t) => (
            <div key={t.nombre} className="w-28">
              <div
                className={`h-12 w-full rounded-lg border border-pand-border ${t.clase}`}
              />
              <p className="mt-2 text-sm font-semibold">pand.{t.nombre}</p>
              <p className="mono text-xs text-pand-gris">{t.hex}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
