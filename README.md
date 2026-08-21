# Pand

Software de cobranzas SaaS multi-tenant.

## Stack

| Capa        | Herramienta                                   |
| ----------- | --------------------------------------------- |
| Framework   | Next.js 14 (App Router, TypeScript, `src/`)   |
| UI          | Tailwind CSS v3 + shadcn/ui                   |
| Datos       | Supabase + Prisma 7 (PostgreSQL)              |
| IA          | Anthropic SDK                                 |
| Colas       | BullMQ + ioredis                              |
| Estado      | TanStack Query / Table                        |
| Formularios | react-hook-form + zod                         |
| Reportes    | recharts, xlsx, papaparse, date-fns           |
| Email       | Resend + React Email                          |

## Arranque

```bash
npm install
cp .env.example .env.local   # completá las claves
npm run dev
```

Abre en http://localhost:3000.

## Design system

Los 7 tokens de marca viven en `tailwind.config.ts` bajo `colors.pand.*`
y como variables CSS en `src/app/globals.css`.

| Token            | Hex       | Uso                                 |
| ---------------- | --------- | ----------------------------------- |
| `pand-celeste`   | `#7BE1FF` | fondos de ícono, destacados         |
| `pand-azul`      | `#006AFF` | botones, links, estados activos     |
| `pand-contorno`  | `#2A2A35` | texto principal, isologo            |
| `pand-gris`      | `#6E6E78` | texto secundario, etiquetas         |
| `pand-coral`     | `#F4707C` | mora y alertas (solo texto/ícono)   |
| `pand-bg`        | `#F6F8FB` | fondo de la app                     |
| `pand-border`    | `#E6E9EE` | bordes y separadores                |

Tipografías: **Manrope** (500–800) para texto, **JetBrains Mono** (400, 500)
para cifras. Aplicá `.mono` a importes, IDs y fechas — incluye `tabular-nums`
para que las columnas numéricas alineen.

Los tokens semánticos de shadcn/ui (`primary`, `destructive`, `muted`…) están
mapeados a esta paleta, así que los componentes salen con la marca puesta sin
tocarlos.

## Secretos

`.env.local` es la única fuente de verdad y está gitignorado. `prisma.config.ts`
lo carga vía dotenv, así que el CLI de Prisma y la app leen las mismas variables.
`.env.example` documenta las claves necesarias y sí se versiona.

## Deuda conocida

- `xlsx` del registry de npm tiene prototype pollution sin fix publicado. Antes
  de parsear planillas subidas por usuarios, migrar al build oficial de SheetJS
  (`https://cdn.sheetjs.com/`).
- `npm audit` reporta CVEs que solo se resuelven subiendo a Next 16 y Prisma 6+.
  Ver notas del scaffold.
