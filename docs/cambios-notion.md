# Cambios pedidos en Notion — qué está hecho y qué falta

Lectura de los tres documentos exportados de Notion el 15/11/2026:
*Modulo Operador*, *Configuracion general* e *Integraciones*. Cada ítem se marca
contra lo que el producto tiene hoy, para no volver a construir algo que ya existe
ni dar por hecho algo que no.

Leyenda: **Hecho** · **Parcial** (existe la base, falta la parte pedida) · **Falta**.

---

## Módulo Operador

| # | Pedido | Estado |
|---|--------|--------|
| 1 | Panel de gestión como pop-up a pantalla completa | **Falta** — hoy es un panel lateral (Sheet) de ancho fijo |
| 2 | Mostrar valor de cuota, tramo de atraso e intereses por día de mora | **Parcial** — el tramo ya se calcula y se muestra; cuota e intereses no existen |
| 3 | Si el cliente debe en varias monedas, mostrar ambas | **Falta** — `invoices.currency` existe por comprobante, pero toda la UI asume una sola moneda por organización |
| 4 | Traer más números: referencias personales | **Parcial** — hay `phone` y `phoneAlt`; no hay entidad de referencias |
| 5 | Identificar deudas en varias carteras | **Falta** — la cartera cuelga del deudor (`clients.portfolio_id`), no del comprobante |
| 6 | Mostrar el producto que se está gestionando | **Hecho** — Bloque 2: columna `invoices.product`, visible en la ficha y filtrable en `/clients` |
| 7 | Enviar mail al cliente desde el panel y guardar la respuesta como gestión | **Falta** — no hay envío ni recepción de correo |
| 8 | Columna "Deuda" = cuotas vencidas y las que vencen en el mes | **Falta** — hoy la columna trae el total de deuda abierta, sin corte por vencimiento |
| 9 | Nuevo módulo Reportes: clientes por tramo, cuántos cobrados y cuánto | **Parcial** — `/reports` existe con recupero, contactabilidad y cumplimiento de promesas. Falta el conteo de **clientes** por tramo (hoy el dashboard muestra montos, no cantidades) |
| 10 | Reporte de disposición de cartera por tipificación (sin gestión, compromisos…) | **Parcial** — la contactabilidad por canal ya cruza tipo y resultado; falta la vista "cuántos clientes hay en cada situación" |
| 11 | Sidebar: módulo Chats, con los chats de los clientes asignados | **Falta** — depende de campañas y de la integración de mensajería |

## Configuración general

| # | Pedido | Estado |
|---|--------|--------|
| 1 | Personalización de resultados de gestión y tipos de llamada | **Falta** — hoy son enums fijos en el código (`ActionType`, `ActionResult`) iguales para todas las organizaciones |
| 2 | Botón para calcular refinanciaciones | **Parcial** — el estado `REFINANCED` existe y se puede poner a mano (Bloque 2); no hay cálculo |
| 3 | Botón de escalamiento (pedir autorización de descuentos) | **Falta** — no hay flujo de aprobación |
| 4 | Módulo de cálculo de intereses, parametrizable por moneda y producto | **Falta** |
| 5 | Plan básico de Score de Riesgo | **Parcial** — la columna `clients.risk_score` existe y la ficha la muestra; nada la calcula |
| 6 | Objetivo de cobro por producto y por vencimiento del mes | **Falta** |
| 7 | Correo propio de cada operador para enviar desde su panel | **Falta** — va junto con el ítem 7 del módulo Operador |

## Integraciones

| # | Pedido | Estado |
|---|--------|--------|
| 1 | Softphone (Yeastar y similares) | **Falta** |
| 2 | MCP para Claude, ChatGPT u otras herramientas | **Falta** |
| 3 | API para recibir cobranzas | **Parcial** — el importador de cobros existe por pantalla; no hay endpoint |
| 4 | API para recibir cartera | **Parcial** — ídem con el importador de cartera |
| 5 | API para enviar reporte de gestión | **Falta** |
| 6 | API para enviar tareas | **Falta** |

El modelo `IntegrationConfig` del P01 ya tiene lo que estas APIs necesitan para
existir —tipo, endpoint, API key encriptada, token de webhook, mapeo de columnas—
pero no hay ninguna ruta que lo use.

---

## Lo que conviene hacer primero, y por qué

Tres cosas desbloquean varias de las demás:

1. **Tipificaciones configurables** (Configuración 1). Hoy los tipos de gestión y
   sus resultados son enums del código. Mientras sigan fijos, el reporte de
   disposición de cartera (Operador 10) solo puede agrupar por categorías que no
   son las del cliente.

   Con una advertencia de diseño: los resultados **no pueden ser texto libre**. El
   producto necesita saber cuál significa "prometió pagar" para armar el reporte de
   promesas, y cuál significa "no hubo nadie" para la contactabilidad. Lo que se
   configura es qué tipificaciones usa cada organización, cómo las llama y qué
   resultados ofrece cada tipo — no qué significan.

2. **Cuota y vencimiento del mes** (Operador 2 y 8). Las dos columnas "Deuda" y el
   objetivo de cobro por vencimiento (Configuración 6) salen de lo mismo: saber
   qué vence en el período, además de qué está vencido. Es un corte nuevo sobre
   `invoices`, no una tabla nueva.

3. **Multi-moneda** (Operador 3). Toca todo lo que hoy formatea plata, así que
   cuanto más se demore, más caro sale. Hoy cada comprobante ya guarda su moneda:
   lo que falta es que la UI deje de asumir una sola.

Lo más grande y más aislado —correo, chats, softphone, MCP— puede ir después sin
bloquear nada de lo anterior.
