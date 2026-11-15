/**
 * El período de un reporte: dos fechas y nada más.
 *
 * Vive aparte de `queries/reports` porque es lógica pura —no toca la base— y así
 * se puede probar sin credenciales ni red. Es el mismo corte que ya existe entre
 * `collections/tramos` y `collections/tramos-sql`.
 */

export type Period = { from: string; to: string };

/**
 * Hoy en Paraguay, como YYYY-MM-DD.
 *
 * El servidor corre en UTC: entre las 20:00 y la medianoche de Asunción, `new Date()`
 * ya está en el día siguiente. Para un reporte diario eso significa abrir la pantalla
 * a la noche y ver el período equivocado.
 */
export function todayInParaguay(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Asuncion",
  });
}

/** Mes corriente, el período por defecto de la pantalla. */
export function currentMonth(): Period {
  const today = todayInParaguay();
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Período pedido por querystring, saneado.
 *
 * Las fechas entran a SQL como parámetros, así que una fecha rara no es un problema
 * de inyección, pero sí de reporte: `to` antes de `from` devuelve todo en cero y
 * parece que no hubo cobranza. Se ordena en vez de mostrar vacío.
 */
export function parsePeriod(raw: {
  from?: string;
  to?: string;
}): Period {
  const fallback = currentMonth();
  const from = raw.from && ISO_DATE.test(raw.from) ? raw.from : fallback.from;
  const to = raw.to && ISO_DATE.test(raw.to) ? raw.to : fallback.to;

  return from <= to ? { from, to } : { from: to, to: from };
}

