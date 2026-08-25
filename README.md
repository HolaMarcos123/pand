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

## Base de datos

Supabase — proyecto `Pand`, ref `dmyuyxqhbwvifzdhmgeg`, región sa-east-1. El schema
vive en `prisma/schema.prisma` y las migraciones en `prisma/migrations/`.

Hay dos conexiones y cada una tiene su rol:

| Variable | Puerto | Quién la usa |
| -------------- | ---- | ------------------------------------------------ |
| `DATABASE_URL` | 6543 | La app en runtime, vía driver adapter (pooling)  |
| `DIRECT_URL`   | 5432 | El CLI de Prisma: migrate, db execute, studio    |

`prisma migrate` **se cuelga** si va por el pooler de transacción: autentica, corre su
primera query y queda esperando sin devolver error. Por eso `prisma.config.ts` apunta
a `DIRECT_URL`. Ojo: `datasource.directUrl` aparece en la documentación de Prisma 7
pero no existe en los tipos de 7.9.1 — ponerlo ahí se ignora en silencio.

Prisma 7 no trae engine nativo: la conexión va por `@prisma/adapter-pg`. Ver
`src/lib/prisma.ts`.

### Aislamiento multi-tenant

RLS activo en las 10 tablas, una policy por tabla. El tenant se resuelve con
`public.current_org_id()`, un subquery contra `users` por `auth.uid()` — no con un
claim del JWT, así que no hay hook que configurar ni token que se desincronice.

**RLS no cubre a Prisma.** El rol `postgres` tiene `BYPASSRLS`, así que las policies
protegen el camino de supabase-js (la anon key viaja al browser), no el de Prisma.
Toda query de Prisma tiene que filtrar por `organizationId` explícitamente.

### Automatismos

- **Trigger** `management_actions_sync_next_action`: al insertar una gestión con
  `next_action_at`, lo propaga a `clients.next_action_at`. Solo en INSERT — las
  gestiones son historial, no se editan.
- **Cron** `pand-refresh-overdue` (pg_cron, 03:15 UTC ≈ 00:15 en Paraguay): recalcula
  `invoices.days_overdue` sobre facturas abiertas y deriva `clients.priority`.
  Corre antes de los recordatorios de las 7:00 del P09.
- `calc_client_priority(dias, deuda, umbral)`: CRITICAL +90 · HIGH 61-90 · MEDIUM
  31-60 · LOW menos. La deuda escala un nivel si supera
  `organizations.settings->>'priority_debt_threshold'`; si el tenant no lo configura,
  solo pesa la mora.

El recálculo **no toca `clients.total_debt`**: ese valor lo mantienen el importador de
carteras y el flujo de cobros.

## Auth y multi-tenancy

- `src/middleware.ts` — refresca la sesión y **cierra todo por defecto**: se enumera
  lo público (`/`, `/login`, `/register`, `/pricing`, `/demo`, `/api/webhooks/*`) y
  el resto exige sesión. El brief pedía proteger `/dashboard/*`, pero los route
  groups de Next no agregan segmento a la URL, así que un matcher sobre `/dashboard`
  no protegería nada.
- `getSession()` en `src/lib/auth/session.ts` cruza el usuario de Supabase Auth con
  su fila en `users` y su organización. Va envuelto en `cache` de React: una sola
  consulta por request sin importar cuántos componentes la pidan.
- `useAuth()` expone `{ user, organization, role, plan, sector, isLoading, signOut }`.
  Los datos bajan del layout servidor, así que el cliente nunca parpadea.
- El onboarding vive en el route group `(onboarding)`, fuera de `(dashboard)`: ese
  layout redirige a `/onboarding` cuando falta completarlo, y si el wizard colgara
  de ahí se redirigiría a sí mismo.

### Formularios

Los que disparan server actions usan `<NativeSelect>`, no el Select de Radix: Radix
renderiza su input oculto vacío en el SSR y lo puebla al hidratar, así que el valor
puede viajar nulo. El de Radix queda para filtros y menús fuera de formularios.

## Dashboard

El shell del producto vive en el route group `(dashboard)`: sidebar de 260px sobre
`#2A2A35`, header de 64px y área de contenido sobre `#F6F8FB`.

- `src/lib/nav.ts` define qué ve cada rol. Eso controla lo que se **dibuja**, no lo
  que se puede alcanzar: las rutas se validan del lado del servidor.
- `src/lib/queries/dashboard.ts` tiene las agregaciones de KPIs, tramos de mora y
  operadores. Van en SQL crudo por los buckets y las subconsultas correlacionadas.
  **Todas filtran por `organization_id`**: Prisma corre con BYPASSRLS y las policies
  no van a atajar un olvido.
- Montos casteados a `::float8` y conteos a `::int` en SQL. Sin eso node-postgres
  devuelve los numeric como string y los count como BigInt, que no se serializan
  hacia un Client Component.

### Autorización: por qué el chequeo va en la página

Next renderiza el layout y la página **en paralelo**. Un layout que devuelve un 403
en lugar de `{children}` esconde la página, pero la página igual se ejecutó: consultó
la base y su resultado quedó en el flight payload de RSC que viaja dentro del HTML.

Pasó de verdad en `/admin/users`: un operador veía el 403 y tenía la lista completa
de usuarios en el código fuente. Por eso **cada página bajo `/admin` valida el rol por
su cuenta y antes del primer `await` a la base**. El layout es presentación.

Si agregás una pantalla bajo `/admin`, repetí el chequeo. Y verificalo contando
ocurrencias en el HTML crudo, no mirando la pantalla.

### TanStack Table v9

El proyecto tiene la **v9**, cuya API no es la de la v8 que documenta casi todo lo que
hay dando vueltas. No existe `useReactTable`: es `useTable({ features, columns, data })`
y las capacidades entran por `features`, junto con las fábricas de row models
(`createSortedRowModel()`, sin argumentos). El core viene por defecto.

## Importación de carteras

El asistente de `/portfolio/new` va en tres pasos: archivo, mapeo de columnas y
confirmación.

### Dónde se parsea el archivo, y por qué

**En el navegador de quien lo sube, nunca en nuestro servidor.** El archivo de un
cliente es contenido no confiable; al backend solo le llegan filas ya mapeadas como
JSON, que se vuelven a validar con zod. La validación del cliente existe para dar
buenos mensajes, no para confiar: un POST armado a mano no pasa por la pantalla de
mapeo.

`xlsx` viene del build oficial de SheetJS (`cdn.sheetjs.com`), **no** del registry de
npm, cuya versión arrastra prototype pollution y ReDoS sin parche. Está pineado en
package.json como URL. SheetJS y papaparse se cargan con import dinámico: solo bajan
cuando hay un archivo de ese tipo.

### El parseo de valores es lo delicado

`src/lib/import/parse-values.ts` es donde se corrompe la plata si uno se descuida:

- `1.234.567` son un millón doscientos mil, no uno con doscientos mil. Un separador
  suelto seguido de 3 dígitos se trata como miles.
- `04/03/2026` es 4 de marzo. Se prueba dd/mm **antes** que mm/dd; invertirlo
  desplaza vencimientos un mes sin que nadie lo note.
- `31/02` se rechaza: JavaScript lo desbordaría a marzo en silencio.

Los números de fila de los errores son los de Excel (encabezado + base 1), para que
el usuario los encuentre en su archivo.

### Reimportar corrige, no duplica

Deudores y comprobantes se hacen upsert por su llave natural dentro del tenant
(`external_id` e `invoice_number`). Reimportar la misma planilla actualiza datos y
deja el estado de gestión intacto: si alguien está trabajando a ese deudor, una carga
nueva no lo reinicia.

El mapeo se guarda en `organization.settings.columnMappings` por sector, así la
segunda carga del mismo ERP no vuelve a pedirlo.

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

- `npm audit` reporta CVEs que solo se resuelven subiendo a Next 16 y Prisma 6+.
  Ver notas del scaffold.

### Pendiente del P02

- **Rate limit no implementado.** El brief pide 100 req/min por `org_id` con Upstash.
  No hay cuenta ni credenciales de Upstash todavía, así que el middleware no limita
  nada. Es lo primero a cerrar antes de exponer la app.
- **Las invitaciones necesitan `SUPABASE_SERVICE_ROLE_KEY`**, que sigue vacía en
  `.env.local`. El paso 2 del onboarding falla con un mensaje explícito hasta que se
  cargue. El resto del flujo —registro, login, onboarding— funciona sin ella.
- El flujo interactivo (submit de los formularios) no se pudo ejercitar de punta a
  punta: el browser embebido de este entorno no alcanza `localhost`. Se verificó por
  HTTP con curl: rutas, redirects del middleware y HTML renderizado.

### Pendiente del P04

El brief pide subir el archivo a Supabase Storage y procesarlo con un worker de
BullMQ. No está: `REDIS_URL` sigue vacía y no hay bucket creado. Hoy la importación
corre por lotes de 500 filas desde el navegador contra server actions, lo que anda
bien para archivos de decenas de miles de filas pero ocupa la pestaña mientras dura.

Para carteras muy grandes o cargas desatendidas hace falta la cola. El seam ya está:
`importBatch` es idempotente por lote, así que un worker puede llamarla igual.

- Falta el importador de **cobros** (mismo asistente, matcheando por documento).
- `GET /api/portfolio/:id/progress` con Supabase Realtime no existe: el progreso hoy
  lo lleva el cliente, que es quien manda los lotes.

