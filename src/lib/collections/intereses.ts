/**
 * Interés por mora: el número que el operador necesita para la llamada.
 *
 * Una advertencia que importa más que el cálculo, y que la pantalla repite:
 * **esto es una estimación, no el saldo legal de la deuda.** El interés real lo
 * liquida el sistema del acreedor, con su propia base de cálculo, sus días de
 * gracia, su capitalización y sus gastos administrativos. Pand no tiene esos
 * datos.
 *
 * Entonces, ¿para qué existe? Porque un operador que llama necesita poder
 * contestar "¿cuánto debo hoy?" con un orden de magnitud correcto en vez de
 * "no sé, averiguo y te llamo" — que es como se pierde una promesa de pago.
 *
 * Si algún día la integración trae el interés liquidado por el ERP, ese gana:
 * este cálculo es el que se usa cuando no hay nada mejor.
 */

/** Interés simple diario. Sin capitalizar: capitalizar sin saber la regla del
 *  acreedor produce números que se despegan rápido de los reales. */
export const BASE_DIAS = 30;

export type ConfigInteres = {
  /**
   * Tasa mensual en porcentaje para las monedas que no tienen la suya.
   * 0 apaga el cálculo para esas monedas.
   */
  tasaMensual: number;
  /**
   * Tasa mensual por moneda ISO, cuando difiere de la general.
   *
   * Existe porque nadie cobra lo mismo en guaraníes que en dólares: una mora
   * del 4,5 % mensual es normal en PYG y disparatada en USD. Con una sola tasa,
   * la ficha de un deudor con prenda en dólares mostraba un interés que el
   * operador no podía decir en voz alta.
   */
  porMoneda: Record<string, number>;
};

export const INTERES_POR_DEFECTO: ConfigInteres = { tasaMensual: 0, porMoneda: {} };

/**
 * La tasa que corresponde a una moneda: la suya si la tiene, la general si no.
 *
 * Sin moneda devuelve la general, que es lo correcto para un saldo del que no
 * se sabe en qué está.
 */
export function tasaDe(config: ConfigInteres, moneda?: string): number {
  const propia = moneda ? config.porMoneda?.[moneda] : undefined;
  const tasa = propia ?? config.tasaMensual;
  return Number.isFinite(tasa) && tasa > 0 ? tasa : 0;
}

/**
 * Interés acumulado sobre un saldo.
 *
 * Devuelve 0 cuando no hay tasa configurada, cuando no hay mora o cuando el
 * saldo no es positivo. Nunca devuelve NaN: este número se muestra en pantalla
 * y se suma a otros.
 */
export function interesAcumulado(
  saldo: number,
  diasDeMora: number,
  config: ConfigInteres,
  moneda?: string,
): number {
  if (!Number.isFinite(saldo) || saldo <= 0) return 0;
  if (!Number.isFinite(diasDeMora) || diasDeMora <= 0) return 0;

  const tasa = tasaDe(config, moneda);
  if (tasa <= 0) return 0;

  const tasaDiaria = tasa / 100 / BASE_DIAS;
  return saldo * tasaDiaria * diasDeMora;
}

/** Lo que corre por día sobre ese saldo, para poder decir "cada día que pasa, X". */
export function interesPorDia(
  saldo: number,
  config: ConfigInteres,
  moneda?: string,
): number {
  if (!Number.isFinite(saldo) || saldo <= 0) return 0;

  const tasa = tasaDe(config, moneda);
  if (tasa <= 0) return 0;

  return (saldo * (tasa / 100)) / BASE_DIAS;
}

/** Una cuota, reducida a lo que el cálculo necesita. */
export type CuotaDeInteres = {
  /** Lo que falta pagar de esa cuota. */
  saldo: number;
  /** Días que lleva vencida. Cero o menos: todavía no venció. */
  diasMora: number;
};

/**
 * Interés de un conjunto de cuotas, **contando solo las vencidas**.
 *
 * Por qué no alcanza con `interesAcumulado(saldoTotal, moraMayor)`: una cuota
 * que vence el mes que viene no devenga mora hoy, y las que ya vencieron no
 * tienen todas la misma antigüedad. Aplicar los días del comprobante más viejo
 * sobre la deuda entera —que es lo que hacía la ficha— cobraba 780 días de mora
 * sobre cuotas que todavía no vencieron. En un crédito a 59 cuotas eso infla el
 * interés varias veces, y el operador lo dice por teléfono.
 *
 * `base` es sobre qué se está cobrando: sirve para explicar el número y para
 * calcular lo que corre por día, que tampoco es sobre el total.
 */
export function interesDeCuotas(
  cuotas: CuotaDeInteres[],
  config: ConfigInteres,
  moneda?: string,
): { interes: number; base: number; porDia: number } {
  let interes = 0;
  let base = 0;

  for (const cuota of cuotas) {
    const parcial = interesAcumulado(cuota.saldo, cuota.diasMora, config, moneda);
    if (parcial <= 0) continue;
    base += cuota.saldo;
    interes += parcial;
  }

  return { interes, base, porDia: interesPorDia(base, config, moneda) };
}

/**
 * Si hay algo que mostrar. Con tasa en cero, la UI no dibuja la columna.
 *
 * Sin moneda pregunta por la organización entera: alcanza con que alguna
 * moneda tenga tasa.
 */
export function calculaInteres(config: ConfigInteres, moneda?: string): boolean {
  if (moneda) return tasaDe(config, moneda) > 0;

  return (
    tasaDe(config) > 0 ||
    Object.values(config.porMoneda ?? {}).some((t) => Number.isFinite(t) && t > 0)
  );
}
