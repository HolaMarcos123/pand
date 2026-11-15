# CobrAI vs. Pand — análisis de brecha y QA

**15 de noviembre de 2026.** Revisión de `cobrai.actuo.app` con sesión iniciada, contra
Pand en `pand-phi.vercel.app`. Cruzado con `cobrai_prompt_maestro.docx` y con el QA de
CobrAI del 13 de noviembre (`QA_CobrAI.xlsx`).

---

## 1. Qué es CobrAI, estructuralmente

El título de la pestaña no es solo un bug cosmético, es la radiografía del producto:

> Cobrai - Multi-Channel Team Inbox & AI Chatbot Platform

CobrAI es una **plataforma de inbox multicanal y chatbot con un módulo de cobranzas
montado encima**. Eso explica casi todos los bugs del QA:

- «Deudores» lleva a `/contacts`, titulada *«Base de datos de contactos del CRM»*
- Contactos: **81**. Cobranzas: **84 deudas**. No cierran porque son dos modelos
- **«Website Visitor»** figura como contacto, canal Webchat
- La Agenda trae categorías Family / Health / Personal
- «Gestiones» lleva a `/tasks`, un gestor de tareas genérico de equipo

Pand está construido **cobranzas-primero**: hay una sola definición de deudor, de
cartera y de tramo.

**Consecuencia para la estrategia:** copiar a CobrAI función por función importaría su
confusión estructural. Hay que copiar las **capacidades**, no el modelo de datos.

---

## 2. Los 11 módulos de CobrAI y qué tiene Pand

| CobrAI | Ruta | Pand |
| --- | --- | --- |
| Inicio | `/inicio` | `/overview` — 3 KPIs, tramos, operadores |
| Cobranzas | `/collections` | parcial (la bandeja cubre parte) |
| Deudores | `/contacts` | ❌ `/clients` da 404 |
| Gestiones | `/tasks` | parcial (gestiones sí, tareas de equipo no) |
| Reportes | `/analytics` | ❌ 404 |
| Agentes IA | `/agents` | ❌ 404 |
| Campañas | `/campaigns` | ❌ |
| Inbox | `/inbox` | ❌ |
| Agenda | `/calendar` | ❌ |
| Segmentos | `/segmentos` | ❌ |
| Pages | `/pages` | ❌ |

Pand tiene **4 pantallas** funcionando contra **11 módulos**.

---

## 3. Lo que CobrAI tiene y Pand no

Ordenado por lo que más falta para vender, no por esfuerzo.

### 3.1 `producto` por deuda
Cada fila dice «Motocicleta Honda Titan 160», «Crédito Personal», «Tarjeta de
Crédito», «Cuotas». Pand solo tiene `description` libre. Una financiera filtra y
reporta por producto.

### 3.2 Tramos legales
CobrAI escala por etapa jurídica: **Pre-legal, Legal, Castigo**, además de los tramos
por días. Pand solo tiene días. Va junto con dos estados nuevos: **Refinanciada** y
**Castigada**.

### 3.3 Búsqueda y paginación
CobrAI pagina con 84 deudas y tiene buscador por deudor, producto y documento. Pand
trae 500 filas de una y sin buscador.

### 3.4 Reportes (14, en 5 categorías)
- **Cobranzas:** análisis de recupero, análisis de cobranza, resumen de aging,
  **aging pivot** (cruce aging × cartera/gestor/score/producto)
- **Deudores:** heatmap aging × score × portfolio, **mapa geográfico** con pins
  alimentado por visitas en terreno
- **Cuotas y pagos:** resumen de pagos por método
- **Gestiones:** productividad por gestor y canal, **cumplimiento de promesas** con
  top 20 de promesas rotas
- **Operativos:** inbox, agentes IA, tareas, campañas

### 3.5 Medios de pago locales
Bancard, Tigo Money, depósito, efectivo. El QA lo marca como el diferencial frente a
Intiza. Pand tiene un enum genérico sin los medios paraguayos.

### 3.6 Campañas y Agentes IA
Envíos masivos por WhatsApp, Email, SMS y Telegram. Un agente «Patricia» con 13
skills (escalación a humano, notas internas, búsqueda en base de conocimiento,
actualización de perfil) y **créditos IA con medidor** — o sea, monetización del
consumo de IA.

### 3.7 Segmentos
Filtros guardados con nombre (tramo, cartera, score, gestor). Barato y muy usado.

---

## 4. Lo que Pand hace mejor

Verificado en vivo. Los cinco bugs de consistencia del QA son exactamente los que Pand
no tiene, porque tiene una sola definición de cada cosa.

| Bug de CobrAI | Verificado | En Pand |
| --- | --- | --- |
| #2 Tramos distintos por pantalla | Inicio usa **10 tramos DDM**, Cobranzas usa **7** | un solo catálogo |
| #3 Conteos que no cierran | 84 deudas vs 81 contactos | una sola fuente |
| #12 Moneda inconsistente | `Gs.` en Inicio, `PYG` en Cobranzas | un solo formateador |
| #1 Aging contradictorio | «Sin cartera activa» con Gs. 763.850.000 arriba | mismo dato para KPI y vacío |
| #8 Score falso | correspondencia **exacta** con el tramo: Castigo/Legal→E, Pre-legal→D, 61-90→C, 31-60→B, 1-30→A | no existe (mejor que uno falso) |

**Duplicados (#4), confirmados:** *Daniela Fernanda Fernández Coronel* con `0961890123`
y `0991345674`; *Manuel Rodrigo González Torres* con `0982456789` y `0981012350`.

**Arquitectura.** CobrAI sirve **995 bytes sin título** y arma todo en el navegador —
de ahí el «Initializing…» y el título de plantilla. Pand sirve **13.285 bytes ya
renderizados**. Durante la revisión una captura falló por *renderer unresponsive*: el
bug #10 (carga lenta) es real.

**Hallazgo nuevo, para sumar al QA:** «CON WHATSAPP: 0 (0% del total)» en Deudores,
cuando la propuesta de valor del producto es recuperar por WhatsApp. Los 81 contactos
tienen teléfono pero ninguno está habilitado.

---

## 5. Brecha de Pand contra su propio prompt maestro

`cobrai_prompt_maestro.docx` es el documento padre de `pand_prompt_maestro_v3.docx`:
misma arquitectura, mismas 9 tablas, mismos módulos.

| Paso | Estado |
| --- | --- |
| P00 Setup + design system | ✅ |
| P01 Schema + RLS + triggers | ✅ |
| P02 Auth + multi-tenancy + onboarding | ✅ |
| P03 Dashboard + KPIs + usuarios | ✅ |
| P04 Ingestión Excel/CSV + cobros | ✅ |
| P05 Bandeja de tareas + panel + cobro | ✅ |
| P12 Deploy | ⚠️ en Vercel, sin GitHub Actions ni tests en CI |
| P06 Integraciones ERP · P07 IA · P08 Reportes · P09 Notificaciones · P10 Llamadas IA · P11 Tests+seed | ❌ |

### Tres hallazgos de comparar los documentos

1. **El menú promete 4 pantallas que no existen.** Verificado en producción con sesión
   de admin: `/clients`, `/reports`, `/ai-agent` y `/admin/settings` dan **404**. Para
   un operador es peor: de los dos ítems que ve, uno está roto.
2. **Faltan `address` y `city` en `clients`.** El schema de CobrAI los tiene. Hacen
   falta para cobranza con visita domiciliaria.
3. **El documento de CobrAI trae una matriz de permisos** que el de Pand no tiene
   (el operador no usa el agente IA, no exporta, no ve reportes globales).

### El hallazgo crítico

**No existe forma de asignar un deudor a un operador.** El importador nunca escribe
`assignedToId`, y no hay pantalla ni acción para asignar: el campo solo aparece en
filtros de lectura.

Consecuencia: **la bandeja de un operador está vacía para siempre.** La demo funcionó
solo porque los clientes se asignaron a mano por SQL. Es el corazón del producto y
está desconectado del resto.

---

## 6. Plan recomendado

No perseguir los 11 módulos. CobrAI tiene amplitud con cimientos flojos; Pand tiene
cimientos firmes y poca superficie. El camino corto a un producto vendible es
ensanchar Pand sin romper su consistencia.

**Bloque 1 — Hacerlo usable**
Asignación de deudores · pantalla `/clients` con búsqueda y paginación · seed con
fechas relativas.

**Bloque 2 — Alcanzar el modelo de CobrAI**
`producto` por deuda · tramos Pre-legal/Legal/Castigo · estados Refinanciada y
Castigada · medios de pago paraguayos · Segmentos.

**Bloque 3 — Reportes**
Empezando por los tres que el QA llama «los 3 KPIs clásicos»: recupero del período,
contactabilidad por canal y cumplimiento de promesas.

Recién después IA y campañas, que es donde CobrAI tiene ventaja pero también donde su
propio QA dice que todo está en cero.
