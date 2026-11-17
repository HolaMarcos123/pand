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
  /** Tasa mensual en porcentaje. 0 apaga el cálculo en toda la aplicación. */
  tasaMensual: number;
};

export const INTERES_POR_DEFECTO: ConfigInteres = { tasaMensual: 0 };

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
): number {
  if (!Number.isFinite(saldo) || saldo <= 0) return 0;
  if (!Number.isFinite(diasDeMora) || diasDeMora <= 0) return 0;
  if (!Number.isFinite(config.tasaMensual) || config.tasaMensual <= 0) return 0;

  const tasaDiaria = config.tasaMensual / 100 / BASE_DIAS;
  return saldo * tasaDiaria * diasDeMora;
}

/** Lo que corre por día sobre ese saldo, para poder decir "cada día que pasa, X". */
export function interesPorDia(saldo: number, config: ConfigInteres): number {
  if (!Number.isFinite(saldo) || saldo <= 0) return 0;
  if (!Number.isFinite(config.tasaMensual) || config.tasaMensual <= 0) return 0;

  return (saldo * (config.tasaMensual / 100)) / BASE_DIAS;
}

/** Si hay algo que mostrar. Con tasa en cero, la UI no dibuja la columna. */
export function calculaInteres(config: ConfigInteres): boolean {
  return Number.isFinite(config.tasaMensual) && config.tasaMensual > 0;
}
