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

### Importador de cobros

`/portfolio/payments`. El brief lo despacha en dos lineas (documento + monto + fecha),
pero un importador de cobros toca plata y tiene tres decisiones que ahi no estan:

**Imputacion FIFO.** Sin comprobante indicado, el cobro baja los vencimientos mas
viejos primero, que es lo que hace cualquier area de cobranzas: descarga la mora que
mas pesa en los tramos. Si la fila trae numero de comprobante, ese va primero.

**Deduplicacion por referencia.** Si la fila trae referencia y ya existe un cobro con
esa referencia en el tenant, se saltea. Es la unica defensa contra subir dos veces la
misma planilla, que duplicaria la plata cobrada y dejaria facturas pagadas que nadie
pago. Hay ademas un indice unico `(organization_id, reference)` en la base por si el
chequeo se escapa; Postgres admite varios NULL, asi que los cobros sin referencia
igual entran. La pantalla avisa antes de importar si la referencia no esta mapeada.

**Un cobro sin deuda abierta igual se registra.** La plata entro: perderla porque no
habia contra que imputarla seria peor que registrarla y avisar. Aparece en el resumen
como "sin imputar".

Aritmetica con `Prisma.Decimal`, no con floats. El match por documento **falla si hay
mas de un deudor con ese documento** en vez de adivinar: el schema no lo declara unico
y adivinar arriesga imputarle el cobro al deudor equivocado.

### Encabezados: los conectores importan

`normalize-header.ts` saca "de", "del", "la"... **antes** de borrar los separadores,
que es el unico momento en que se sabe donde termina una palabra. Sin eso
"Forma de Pago" queda como `formadepago` y no matchea contra `formapago`. Fue un bug
real: todos los medios de pago entraban como OTHER, y "Fecha de Vencimiento" tampoco
matcheaba en el importador de cartera.

## Bandeja de tareas

`/tasks`. Entran los deudores que no esten pagados ni perdidos y cuyo proximo
seguimiento ya vencio (o que nunca tuvieron uno). Orden: critica → alta → media →
baja, y dentro de cada tramo la deuda mas grande primero.

**No hace falta ningun cron para que un deudor "vuelva" a la bandeja.** El brief
propone un job horario que los devuelva, pero la condicion `next_action_at <= now()`
ya los trae sola en cuanto pasa la hora. Un job que reescribiera filas para lograr lo
mismo solo agregaria escrituras y una ventana de hasta una hora en la que la bandeja
miente.

El operador ve solo su cartera; supervisores y admins ven todo, porque son quienes
reparten la carga. El filtro esta en la query, no en la UI.

### Una sola imputacion de cobros

`src/lib/payments/apply.ts` es la unica aritmetica de "como baja una deuda", y la
usan las dos entradas de plata: el importador de planillas y el modal de la bandeja.
Si cada una tuviera la suya, tarde o temprano dejarian el mismo cobro en estados
distintos y los numeros del dashboard no cerrarian contra la cartera.

### Dos reglas que se validan en el servidor

- **El resultado tiene que corresponder al tipo de gestion.** Un email no puede estar
  "ocupado". El selector ya lo limita, pero la server action lo vuelve a chequear: sin
  eso, un POST armado a mano ensucia los reportes de efectividad por canal.
- **Una promesa necesita monto y fecha.** Sin eso no se le puede hacer seguimiento, y
  una promesa que no se puede seguir no es una promesa.

`clients.next_action_at` no lo escribe el codigo: lo propaga el trigger del P01.
Escribirlo tambien desde la action seria una segunda fuente de verdad para el mismo
dato.

### Cerrojo del alta publica

`REGISTRATION_OPEN`. Mientras Pand este desplegado en una URL adivinable y sin
landing, cualquiera que llegue podria crearse una organizacion con 14 dias de trial.

**El default es cerrado y es deliberado:** si la variable no esta definida —entorno
nuevo, preview, alguien que se olvido— el registro queda cerrado. La alternativa
(abierto por defecto) significa que un olvido abre el alta en produccion sin que
nadie se entere.

Solo `REGISTRATION_OPEN=true`, exactamente, la abre. El chequeo que cuenta esta en
`signUpAction`: esconder el formulario no impide invocar la server action
directamente. La pantalla y el link del login son presentacion.

`/register` y `/login` se resuelven por request (`force-dynamic`), asi que abrir o
cerrar el alta es cambiar la variable y redesplegar, sin reconstruir.

## Clientes y asignacion

`/clients`. Listado con busqueda (nombre, documento, ID externo), filtros por cartera,
prioridad, estado y operador, y **paginacion real** (LIMIT/OFFSET + COUNT aparte): una
cartera importada puede tener decenas de miles de filas y esta es justo la pantalla
que se abre despues de importar.

### Por que la asignacion era bloqueante

El importador no escribe `assigned_to` y hasta ahora no habia forma de asignar. La
bandeja filtra por operador, asi que **la bandeja de un operador estaba vacia para
siempre**: se podian importar 5.000 deudores y nadie podia trabajarlos.

Dos caminos, ambos de admin o supervisor:

- **Asignacion puntual:** seleccion multiple en la tabla y "Asignar a".
- **Reparto automatico:** round-robin por deuda descendente. El orden importa:
  rotando operadores sobre una lista ordenada por monto, cada uno recibe una mezcla
  pareja de casos grandes y chicos. Al azar, alguien se queda con toda la cartera
  pesada; en bloques, peor. Va en un solo SQL porque fila por fila desde Node seria
  una tormenta de queries.

El destinatario se valida contra la organizacion antes de escribir, y el `updateMany`
tambien filtra por `organizationId`: los ids llegan del cliente y Prisma corre con
BYPASSRLS.

## Seed de demostracion

`npm run seed` genera "Financiera Pand Demo": 7 usuarios, 2 carteras, 200 deudores ya
repartidos entre los operadores, ~450 comprobantes, gestiones, promesas y cobros.

**Todas las fechas son relativas al dia de ejecucion.** Un seed con fechas fijas se
pudre: a los dos meses el recupero del mes es cero y toda la cartera cae en +90 — que
es exactamente lo que le paso a los datos de prueba anteriores. El generador usa
semilla fija, asi que dos corridas producen la misma cartera.

Borra y recrea la organizacion por su slug: es seguro correrlo muchas veces y no toca
ninguna otra organizacion.

    admin@pand.demo · supervisor1@pand.demo · operador1@pand.demo … / PandDemo2026!

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

## Tests y CI

Dos suites, separadas a propósito.

```bash
npm test        # lógica pura, sin base ni red. Segundos.
npm run test:db # contra la base real. Un minuto.
```

`npm test` cubre lo que no necesita base: los bordes de los tramos, el parseo de
medios de pago, los alias del importador, el formateo de fechas y montos, y la
validación de filas del importador. Es lo que corre CI en cada push.

`npm run test:db` prueba las consultas de verdad contra Supabase, con las
credenciales de `.env.local`. **Cada test se crea su propia organización con un
slug `test-…` y la borra al terminar**, así que no toca la demo ni ninguna cartera
real, y se puede correr las veces que haga falta. Si una corrida se interrumpe a
la mitad puede quedar una organización huérfana: se limpian borrando las
organizaciones cuyo slug empieza con `test-`.

Lo que prueba, y por qué importa:

- **Tramos.** Que la expresión SQL que filtra y la función de TypeScript que pinta
  la columna digan lo mismo, y que los tramos particionen la cartera sin huecos ni
  solapamientos.
- **Promesas.** Que el cumplimiento no pase del 100 % cuando alguien paga de más,
  que las vigentes no entren en el divisor, y que reprometer para la misma fecha no
  multiplique el monto prometido.
- **Cobros.** FIFO, comprobantes elegidos a mano, sobrante devuelto, y que un cobro
  no toque deuda castigada o refinanciada.
- **Aislamiento entre organizaciones.** El más importante. Prisma se conecta como
  `postgres`, que tiene **BYPASSRLS**: las policies no corren para las consultas de
  la app, y lo único que separa a un cliente de otro es el `organization_id`
  escrito a mano en cada consulta. Un `WHERE` olvidado no lo ataja nada. Por eso
  cada consulta se prueba contra una segunda organización **con datos propios y más
  grandes**, no contra una vacía: una consulta mal filtrada devuelve las dos
  carteras, y contra una base vacía eso no se nota.

### CI

`.github/workflows/ci.yml` corre en cada push a `main` y en cada pull request:
tipos, lint, tests de lógica y build. El build va último porque encuentra cosas
que `tsc` no ve — un componente cliente que arrastra código de servidor al bundle
del browser, por ejemplo, solo se cae ahí.

Los tests contra la base van en un job aparte y solo corren si está configurado el
secreto `TEST_DATABASE_URL` (Settings → Secrets and variables → Actions). Sin el
secreto el job se saltea en vez de fallar en rojo. Conviene apuntarlo a un
proyecto de Supabase que no sea el de producción.

## Secretos

`.env.local` es la única fuente de verdad y está gitignorado. `prisma.config.ts`
lo carga vía dotenv, así que el CLI de Prisma y la app leen las mismas variables.
`.env.example` documenta las claves necesarias y sí se versiona.

## Deuda conocida

- **Sin tests de interfaz.** Las suites cubren consultas y lógica, no lo que pasa
  al hacer clic. El flujo de pantalla se sigue verificando a mano contra el build
  de producción.
- Tailwind sigue en v3.4. No tiene CVE: subir a v4 es riesgo visual, no de
  seguridad, así que va aparte.

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

- `GET /api/portfolio/:id/progress` con Supabase Realtime no existe: el progreso hoy
  lo lleva el cliente, que es quien manda los lotes.

