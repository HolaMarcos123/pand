/**
 * Seed de demostración (paso P11 del brief).
 *
 * Genera una organización completa con cartera, gestiones, promesas y cobros.
 *
 * Dos decisiones que importan:
 *
 * 1. **Todas las fechas son relativas a hoy.** Un seed con fechas fijas se pudre: a
 *    los dos meses el "recupero del mes" es cero y toda la cartera está en +90, que
 *    es exactamente lo que le pasó a los datos de prueba anteriores. Acá los
 *    vencimientos se calculan como desplazamientos desde la fecha de ejecución.
 *
 * 2. **Los deudores quedan repartidos entre los operadores.** Un seed sin asignar
 *    deja las bandejas vacías y da la impresión de que el producto no funciona.
 *
 * Se ejecuta con `npm run seed`. Borra y recrea la organización demo por su slug, así
 * que es seguro correrlo muchas veces y no toca ninguna otra organización.
 */
import { randomUUID } from "node:crypto";

import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "../src/generated/prisma/client.js";

loadEnv({ path: ".env.local" });

// El seed escribe mucho y usa funciones de Postgres: va por la conexión directa
// (5432), no por el pooler de transacción.
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Falta DIRECT_URL (o DATABASE_URL) en .env.local");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG_SLUG = "financiera-pand-demo";
const ORG_NAME = "Financiera Pand Demo";
const PASSWORD = "PandDemo2026!";
const DOMAIN = "pand.demo"; // .demo no existe: ningún email puede salir hacia ahí

// ─────────────────────────── Datos de fantasía ───────────────────────────

const NOMBRES = ["María","José","Ana","Carlos","Rosa","Juan","Laura","Miguel","Carmen","Pedro","Lucía","Diego","Patricia","Ramón","Silvia","Gustavo","Mirta","Fernando","Gloria","Óscar","Beatriz","Hugo","Norma","Raúl","Liliana","Víctor","Elena","Marcos","Teresa","Alberto"];
const SEGUNDOS = ["Isabel","Ramón","Beatriz","Andrés","Mercedes","Carlos","Fernanda","Ángel","Rosario","Daniel","Soledad","Javier","Elena","Eduardo","Noemí","Antonio","Raquel","Sebastián","Cristina","Marcelo"];
const APELLIDOS = ["González","Rodríguez","Martínez","Benítez","Fernández","López","Giménez","Torres","Ramírez","Villalba","Cáceres","Ortiz","Duarte","Acosta","Estigarribia","Espínola","Rojas","Insfrán","Ayala","Vera","Samaniego","Riveros","Aquino","Franco","Bogado"];

const PRODUCTOS = ["Crédito personal","Préstamo prendario","Tarjeta de crédito","Crédito comercial","Cuota de electrodoméstico","Financiación de motocicleta"];

const COMENTARIOS_CONTACTO = [
  "Atiende y dice que está sin trabajo. Pide un plan.",
  "Confirma que recibió el estado de cuenta.",
  "Pide que lo llamen después de las 18.",
  "Dice que ya pagó, se le solicita comprobante.",
  "Número contestado por un familiar.",
  "Se compromete a acercarse a la sucursal.",
];
const COMENTARIOS_SIN_CONTACTO = [
  "Suena y corta.",
  "Buzón de voz, se deja mensaje.",
  "Número fuera de servicio.",
  "No atiende, tercer intento del día.",
];

// Generador con semilla: dos corridas producen la misma cartera, así que una captura
// de pantalla de la demo sigue siendo válida mañana.
let semilla = 20260823;
function rnd(): number {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
}
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const entre = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));

/** Fecha a N días de hoy. Negativo = pasado. */
function dias(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** Monto en guaraníes, redondeado a la decena de miles. */
function guaranies(min: number, max: number): number {
  return Math.round((min + rnd() * (max - min)) / 10000) * 10000;
}

// ─────────────────────────── Usuarios de Supabase Auth ───────────────────────────

/**
 * Crea el usuario en auth.users directamente.
 *
 * Las columnas de token se ponen en '' y no en NULL a proposito: GoTrue las escanea
 * como strings y con NULL falla el login entero con "Database error querying schema".
 */
async function crearAuthUser(id: string, email: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token,
      reauthentication_token
    ) VALUES (
      ${id}::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated', 'authenticated', ${email},
      extensions.crypt(${PASSWORD}, extensions.gen_salt('bf')), now(),
      now(), now(), '{"provider":"email","providers":["email"]}'::jsonb,
      ${JSON.stringify({ full_name: nombre })}::jsonb,
      '', '', '', '', '', '', '', ''
    )
  `;

  await prisma.$executeRaw`
    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${id}::uuid, ${id},
      ${JSON.stringify({ sub: id, email, email_verified: true })}::jsonb,
      'email', now(), now(), now()
    )
  `;
}

// ─────────────────────────── Seed ───────────────────────────

async function main() {
  console.log(`Sembrando "${ORG_NAME}"…`);

  // Borrar y recrear: el cascade se lleva usuarios, cartera, facturas y gestiones.
  const previa = await prisma.organization.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, users: { select: { id: true } } },
  });

  if (previa) {
    const ids = previa.users.map((u) => u.id);
    await prisma.organization.delete({ where: { id: previa.id } });
    if (ids.length) {
      await prisma.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${ids}::uuid[])`;
    }
    console.log("  organización previa eliminada");
  }

  const organizationId = randomUUID();
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: ORG_NAME,
      slug: ORG_SLUG,
      sector: "FINANCIAL",
      plan: "PROFESSIONAL",
      seatsUsed: 7,
      seatsMax: 25,
      isOnboarded: true,
      trialEnds: dias(14),
      settings: {
        country: "PY",
        currency: "PYG",
        timezone: "America/Asuncion",
        // Una tasa plausible para una financiera paraguaya, para que la ficha
        // del deudor muestre interes y se pueda ver como queda.
        cobranza: { tasaMensual: 4.5 },
      },
    },
  });

  // ── Equipo ──────────────────────────────────────────────
  const equipo = [
    { email: `admin@${DOMAIN}`, nombre: "Marcos Paredes", role: "ADMIN" as const },
    { email: `supervisor1@${DOMAIN}`, nombre: "Claudia Benítez", role: "SUPERVISOR" as const },
    { email: `supervisor2@${DOMAIN}`, nombre: "Ariel Gómez", role: "SUPERVISOR" as const },
    { email: `operador1@${DOMAIN}`, nombre: "Ana Duarte", role: "OPERATOR" as const },
    { email: `operador2@${DOMAIN}`, nombre: "Beto Rojas", role: "OPERATOR" as const },
    { email: `operador3@${DOMAIN}`, nombre: "Celia Ortiz", role: "OPERATOR" as const },
    { email: `operador4@${DOMAIN}`, nombre: "Darío Vera", role: "OPERATOR" as const },
  ];

  const usuarios: { id: string; role: string; nombre: string }[] = [];
  for (const persona of equipo) {
    const id = randomUUID();
    await crearAuthUser(id, persona.email, persona.nombre);
    await prisma.user.create({
      data: {
        id,
        organizationId,
        email: persona.email,
        fullName: persona.nombre,
        role: persona.role,
        lastLoginAt: dias(-entre(0, 5)),
      },
    });
    usuarios.push({ id, role: persona.role, nombre: persona.nombre });
  }
  const operadores = usuarios.filter((u) => u.role === "OPERATOR");
  console.log(`  ${usuarios.length} usuarios (${operadores.length} operadores)`);

  // ── Carteras ────────────────────────────────────────────
  const adminId = usuarios[0].id;
  const carteras = [
    { id: randomUUID(), name: "Cartera consumo", sectorType: "FINANCIAL" as const },
    { id: randomUUID(), name: "Cartera prendaria", sectorType: "FINANCIAL" as const },
  ];
  for (const c of carteras) {
    await prisma.portfolio.create({
      data: {
        id: c.id,
        organizationId,
        name: c.name,
        sectorType: c.sectorType,
        source: "EXCEL",
        status: "ACTIVE",
        uploadedById: adminId,
        createdAt: dias(-entre(40, 80)),
      },
    });
  }

  // ── Deudores, comprobantes, gestiones y cobros ──────────
  // Distribución de mora del brief: 25% 0-30, 30% 31-60, 25% 61-90, 20% +90.
  const TRAMOS = [
    { peso: 0.25, min: 1, max: 30 },
    { peso: 0.3, min: 31, max: 60 },
    { peso: 0.25, min: 61, max: 90 },
    { peso: 0.2, min: 91, max: 240 },
  ];

  const TOTAL = 200;
  const clientes: { id: string; mora: number }[] = [];
  const facturas: Prisma.InvoiceCreateManyInput[] = [];
  const gestiones: Prisma.ManagementActionCreateManyInput[] = [];
  const cobros: Prisma.PaymentCreateManyInput[] = [];

  for (let i = 0; i < TOTAL; i += 1) {
    const clientId = randomUUID();
    const nombre = `${pick(NOMBRES)} ${pick(SEGUNDOS)} ${pick(APELLIDOS)} ${pick(APELLIDOS)}`;

    // Tramo según la distribución acumulada.
    let r = rnd();
    let tramo = TRAMOS[TRAMOS.length - 1];
    for (const t of TRAMOS) {
      if (r < t.peso) { tramo = t; break; }
      r -= t.peso;
    }
    const moraMax = entre(tramo.min, tramo.max);
    const cartera = carteras[i % carteras.length];

    clientes.push({ id: clientId, mora: moraMax });

    await prisma.client.create({
      data: {
        id: clientId,
        organizationId,
        portfolioId: cartera.id,
        externalId: `DEMO-${String(i + 1).padStart(4, "0")}`,
        name: nombre,
        documentNumber: `${entre(1, 6)}.${entre(100, 999)}.${entre(100, 999)}`,
        email: rnd() < 0.55 ? `cliente${i + 1}@${DOMAIN}` : null,
        phone: `09${entre(61, 85)}${entre(100000, 999999)}`,
        phoneAlt: rnd() < 0.25 ? `021${entre(200000, 699999)}` : null,
        currency: "PYG",
        // Repartidos desde el arranque: sin esto las bandejas quedan vacías.
        assignedToId: operadores[i % operadores.length].id,
        riskScore: entre(10, 95),
        createdAt: dias(-entre(40, 80)),
      },
    });

    // Un deudor suele deber por un solo producto; a veces por dos.
    const productoPrincipal = pick(PRODUCTOS);

    // Uno de cada diez debe ademas en dolares: una prenda, tipicamente. Sin
    // esto no hay con que probar el caso multi-moneda, que es el que mas
    // confunde cuando aparece por primera vez con un cliente real.
    const tambienEnDolares = rnd() < 0.1;

    // Una porción chica de la cartera ya salió de lo activo: castigada o
    // refinanciada. Sin esto no hay con qué probar el tramo Castigo ni los estados
    // nuevos, y el filtro se ve siempre vacío.
    const suerte = rnd();
    const castigado = suerte < 0.05;
    const refinanciado = !castigado && suerte < 0.09;

    // 1 a 4 comprobantes, el más viejo define la mora del tramo.
    const cantidad = entre(1, 4);
    for (let j = 0; j < cantidad; j += 1) {
      const vencimiento = j === 0 ? -moraMax : -Math.max(0, moraMax - entre(30, 90) * j);
      const monto = guaranies(350_000, 18_000_000);
      // Un cuarto de los comprobantes tiene pago parcial.
      const parcial = rnd() < 0.25 ? Math.round(monto * (0.2 + rnd() * 0.5)) : 0;

      const estado = castigado
        ? "WRITTEN_OFF"
        : refinanciado
          ? "REFINANCED"
          : parcial > 0
            ? "PARTIAL"
            : "PENDING";

      // Solo el ultimo comprobante va en dolares, para que el deudor quede con
      // deuda en las dos monedas y no solo en una.
      const enDolares = tambienEnDolares && j === cantidad - 1;

      facturas.push({
        id: randomUUID(),
        organizationId,
        clientId,
        invoiceNumber: `F-${String(i + 1).padStart(4, "0")}-${j + 1}`,
        product: rnd() < 0.2 ? pick(PRODUCTOS) : productoPrincipal,
        description: pick(PRODUCTOS),
        // El dolar no lleva montos de siete cifras: se divide para que el
        // numero sea creible al lado de los guaranies.
        amount: enDolares ? Math.round(monto / 7000) : monto,
        paidAmount: enDolares ? 0 : parcial,
        status: estado,
        currency: enDolares ? "USD" : "PYG",
        dueDate: dias(vencimiento),
      });

      if (parcial > 0 && !enDolares) {
        cobros.push({
          id: randomUUID(),
          organizationId,
          clientId,
          amount: parcial,
          currency: "PYG",
          // Dentro del mes en curso para que el KPI de recupero tenga contenido.
          paymentDate: dias(-entre(0, new Date().getUTCDate() - 1)),
          paymentMethod: pick(["BANK_TRANSFER", "CASH", "DEPOSIT", "CARD"] as const),
          reference: `REC-${i + 1}-${j + 1}`,
          registeredById: operadores[i % operadores.length].id,
        });
      }
    }

    // La mitad tiene historial de gestiones.
    if (rnd() < 0.5) {
      const cuantas = entre(1, 4);
      for (let k = 0; k < cuantas; k += 1) {
        const contacto = rnd() < 0.6;
        gestiones.push({
          id: randomUUID(),
          organizationId,
          clientId,
          operatorId: operadores[i % operadores.length].id,
          actionType: pick(["CALL", "WHATSAPP", "EMAIL", "SMS"] as const),
          result: contacto
            ? pick(["PROMISE_PAY", "CALLBACK", "REFUSED", "PAID"] as const)
            : pick(["NO_ANSWER", "BUSY", "WRONG_NUMBER"] as const),
          comment: contacto ? pick(COMENTARIOS_CONTACTO) : pick(COMENTARIOS_SIN_CONTACTO),
          createdAt: dias(-entre(1, 30)),
        });
      }
    }

    // Un quinto tiene promesa vigente.
    if (rnd() < 0.2) {
      const cuando = entre(1, 12);
      gestiones.push({
        id: randomUUID(),
        organizationId,
        clientId,
        operatorId: operadores[i % operadores.length].id,
        actionType: "CALL",
        result: "PROMISE_PAY",
        comment: "Se compromete a pagar.",
        promiseAmount: guaranies(500_000, 9_000_000),
        promiseDate: dias(cuando),
        // Sin next_action_at: el trigger lo propagaría y lo sacaría de la bandeja.
        createdAt: dias(-entre(1, 6)),
      });
    }

    // Otro quinto tiene una promesa **ya vencida**, con los tres desenlaces
    // posibles: cumplida, pagada en parte y rota.
    //
    // Sin esto el reporte de cumplimiento de promesas se abre vacío. Todas las
    // promesas de arriba vencen en el futuro, así que no hay todavía nada que haya
    // salido bien ni mal, y la pantalla que mide justamente eso no muestra nada.
    if (rnd() < 0.22) {
      const prometido = guaranies(500_000, 9_000_000);
      const vencio = entre(5, 25); // días atrás en que vencía
      const prometidaEl = vencio + entre(2, 8); // se comprometió antes de la fecha
      const desenlace = rnd();

      gestiones.push({
        id: randomUUID(),
        organizationId,
        clientId,
        operatorId: operadores[i % operadores.length].id,
        actionType: "CALL",
        result: "PROMISE_PAY",
        comment: "Se compromete a pagar.",
        promiseAmount: prometido,
        promiseDate: dias(-vencio),
        createdAt: dias(-prometidaEl),
      });

      if (desenlace < 0.45) {
        // Cumplió: pagó lo prometido dentro del plazo.
        cobros.push({
          id: randomUUID(),
          organizationId,
          clientId,
          amount: prometido,
          currency: "PYG",
          paymentDate: dias(-vencio + entre(0, 2)),
          paymentMethod: pick(["BANCARD", "TIGO_MONEY", "PAGO_EXPRESS", "CASH"] as const),
          reference: `PRM-${i + 1}-OK`,
          registeredById: operadores[i % operadores.length].id,
        });
      } else if (desenlace < 0.7) {
        // Pagó una parte: ni cumplida ni rota, que es el caso que más discuten
        // el supervisor y el operador.
        cobros.push({
          id: randomUUID(),
          organizationId,
          clientId,
          amount: Math.round((prometido * 0.4) / 10000) * 10000,
          currency: "PYG",
          paymentDate: dias(-vencio + entre(0, 2)),
          paymentMethod: pick(["AQUI_PAGO", "PERSONAL_ENVIOS", "DEPOSIT"] as const),
          reference: `PRM-${i + 1}-PARC`,
          registeredById: operadores[i % operadores.length].id,
        });
      }
      // El resto no pagó nada: promesa rota, y aparece en el top del reporte.
    }
    // Cuotas que todavia no vencieron.
    //
    // Sin esto el seed miente por omision: toda la cartera queda vencida, y
    // entonces "deuda del mes" y "deuda total" dan siempre el mismo numero y la
    // distincion parece inutil. Una financiera de verdad tiene un plan de pagos
    // con cuotas por delante, y el operador gestiona lo vencido mas lo que
    // vence este mes, no las de dentro de medio año.
    if (rnd() < 0.55) {
      const cuotasFuturas = entre(1, 4);
      for (let k = 1; k <= cuotasFuturas; k += 1) {
        facturas.push({
          id: randomUUID(),
          organizationId,
          clientId,
          invoiceNumber: `F-${String(i + 1).padStart(4, "0")}-C${k}`,
          product: productoPrincipal,
          description: "Cuota a vencer",
          amount: guaranies(350_000, 6_000_000),
          paidAmount: 0,
          status: "PENDING",
          currency: "PYG",
          // La primera cae dentro de este mes y las demas en los siguientes: es
          // la unica forma de que el corte por fin de mes separe algo.
          dueDate: dias(entre(2, 12) + (k - 1) * 30),
        });
      }
    }
  }

  await prisma.invoice.createMany({ data: facturas });
  await prisma.managementAction.createMany({ data: gestiones });
  await prisma.payment.createMany({ data: cobros });
  console.log(
    `  ${TOTAL} deudores · ${facturas.length} comprobantes · ${gestiones.length} gestiones · ${cobros.length} cobros`,
  );

  // ── Consistencia final ──────────────────────────────────
  // La deuda del cliente sale de sus comprobantes abiertos, igual que en el
  // importador; después se recalculan mora y prioridad con la misma función que el
  // cron nocturno, para que la demo abra con los números correctos.
  await prisma.$executeRaw`
    UPDATE clients c
       SET total_debt = COALESCE((
             SELECT SUM(i.amount - i.paid_amount) FROM invoices i
              WHERE i.client_id = c.id AND i.status IN ('PENDING','PARTIAL')
           ), 0)
     WHERE c.organization_id = ${organizationId}::uuid
  `;
  // Mismo criterio que refreshClientBalance: sin deuda abierta y con algo
  // castigado, el deudor es Perdido, no Pagado.
  await prisma.$executeRaw`
    UPDATE clients c
       SET status = 'LOST'::"ClientStatus"
     WHERE c.organization_id = ${organizationId}::uuid
       AND NOT EXISTS (
             SELECT 1 FROM invoices i
              WHERE i.client_id = c.id AND i.status IN ('PENDING','PARTIAL')
           )
       AND EXISTS (
             SELECT 1 FROM invoices i
              WHERE i.client_id = c.id AND i.status = 'WRITTEN_OFF'
           )
  `;
  await prisma.$executeRaw`SELECT public.refresh_overdue_and_priority()`;

  await prisma.$executeRaw`
    UPDATE portfolios p
       SET total_clients = agg.n, total_amount = agg.total
      FROM (SELECT portfolio_id, count(*)::int AS n, COALESCE(sum(total_debt),0) AS total
              FROM clients WHERE organization_id = ${organizationId}::uuid
             GROUP BY portfolio_id) agg
     WHERE p.id = agg.portfolio_id
  `;

  console.log("\nListo. Entrá con cualquiera de estos:");
  for (const p of equipo) console.log(`  ${p.role.padEnd(10)} ${p.email}`);
  console.log(`  Contraseña: ${PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("\nEl seed falló:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
