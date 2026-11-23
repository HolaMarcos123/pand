import { describe, expect, it } from "vitest";

import {
  BASE_DIAS,
  INTERES_POR_DEFECTO,
  calculaInteres,
  tasaDe,
  type ConfigInteres,
  interesAcumulado,
  interesDeCuotas,
  interesPorDia,
} from "@/lib/collections/intereses";
import { resolverSettings } from "@/lib/config/settings";

/**
 * El interés es el número que el operador le dice al deudor por teléfono.
 *
 * Por eso lo que más importa de estos tests no es la aritmética —que es
 * trivial— sino que el cálculo **nunca produzca un número raro**: ni NaN, ni
 * negativo, ni interés sobre una deuda que no está vencida. Cualquiera de esos
 * se convierte en una cifra dicha en voz alta que después hay que desdecir.
 */

const TASA = { tasaMensual: 4.5, porMoneda: {} };

describe("interesAcumulado", () => {
  it("interés simple: tasa mensual repartida en 30 días", () => {
    // 1.000.000 al 4,5 % mensual = 45.000 por mes = 1.500 por día.
    expect(interesAcumulado(1_000_000, 30, TASA)).toBeCloseTo(45_000, 6);
    expect(interesAcumulado(1_000_000, 1, TASA)).toBeCloseTo(1_500, 6);
    expect(interesAcumulado(1_000_000, 90, TASA)).toBeCloseTo(135_000, 6);
  });

  it("no capitaliza: 90 días es exactamente el triple de 30", () => {
    // Capitalizar sin conocer la regla del acreedor produce números que se
    // despegan rápido de los reales. Si alguien agrega capitalización, este
    // test falla y obliga a pensarlo.
    const a30 = interesAcumulado(2_000_000, 30, TASA);
    const a90 = interesAcumulado(2_000_000, 90, TASA);
    expect(a90).toBeCloseTo(a30 * 3, 6);
  });

  it("sin mora no hay interés", () => {
    for (const dias of [0, -1, -400]) {
      expect(interesAcumulado(1_000_000, dias, TASA)).toBe(0);
    }
  });

  it("sin tasa configurada no hay interés", () => {
    expect(interesAcumulado(1_000_000, 90, { tasaMensual: 0, porMoneda: {} })).toBe(0);
    expect(interesAcumulado(1_000_000, 90, INTERES_POR_DEFECTO)).toBe(0);
  });

  it("un saldo cero o negativo no genera interés", () => {
    // Un comprobante sobrepagado tiene saldo negativo: cobrarle interés a eso
    // daría un número negativo en pantalla.
    expect(interesAcumulado(0, 90, TASA)).toBe(0);
    expect(interesAcumulado(-50_000, 90, TASA)).toBe(0);
  });

  it("nunca devuelve NaN, por más basura que entre", () => {
    const basura = [NaN, Infinity, -Infinity];
    for (const valor of basura) {
      expect(Number.isNaN(interesAcumulado(valor, 30, TASA))).toBe(false);
      expect(Number.isNaN(interesAcumulado(1_000_000, valor, TASA))).toBe(false);
      expect(
        Number.isNaN(interesAcumulado(1_000_000, 30, { tasaMensual: valor, porMoneda: {} })),
      ).toBe(false);
    }
  });
});

describe("interesPorDia", () => {
  it("es el acumulado de un día", () => {
    expect(interesPorDia(1_000_000, TASA)).toBeCloseTo(
      interesAcumulado(1_000_000, 1, TASA),
      6,
    );
  });

  it("la base son 30 días, no el mes calendario", () => {
    // Si fuera el mes calendario, el interés diario cambiaría entre febrero y
    // marzo sobre la misma deuda, y el deudor lo notaría.
    expect(interesPorDia(BASE_DIAS * 1000, { tasaMensual: 100, porMoneda: {} })).toBeCloseTo(1000, 6);
  });
});

describe("calculaInteres", () => {
  it("decide si la UI dibuja la columna", () => {
    expect(calculaInteres({ tasaMensual: 4.5, porMoneda: {} })).toBe(true);
    expect(calculaInteres({ tasaMensual: 0, porMoneda: {} })).toBe(false);
    expect(calculaInteres({ tasaMensual: NaN, porMoneda: {} })).toBe(false);
  });
});

describe("la tasa en la configuración", () => {
  it("sin configurar, viene en cero: no se inventa un interés", () => {
    // Mostrar un interés que nadie configuró es peor que no mostrar ninguno,
    // porque el operador se lo dice al deudor como si fuera cierto.
    expect(resolverSettings({}).cobranza.tasaMensual).toBe(0);
    expect(resolverSettings(null).cobranza.tasaMensual).toBe(0);
  });

  it("se lee la tasa guardada", () => {
    expect(
      resolverSettings({ cobranza: { tasaMensual: 3.75, porMoneda: {} } }).cobranza.tasaMensual,
    ).toBe(3.75);
  });

  it("una tasa imposible se descarta y queda en cero", () => {
    for (const valor of [-5, 450, "mucho", null]) {
      expect(
        resolverSettings({ cobranza: { tasaMensual: valor, porMoneda: {} } }).cobranza.tasaMensual,
        `con ${JSON.stringify(valor)}`,
      ).toBe(0);
    }
  });
});

describe("tasa por moneda", () => {
  /**
   * El caso que lo motiva: 4,5 % mensual es corriente en guaranies y
   * disparatado en dolares. Con una sola tasa, la ficha de un deudor con
   * prenda en dolares mostraba un interes que el operador no podia decir.
   */
  const MIXTA: ConfigInteres = { tasaMensual: 4.5, porMoneda: { USD: 1.2 } };

  it("la moneda con tasa propia usa la suya", () => {
    expect(tasaDe(MIXTA, "USD")).toBe(1.2);
    expect(interesAcumulado(1_000, 30, MIXTA, "USD")).toBeCloseTo(12, 6);
  });

  it("la moneda sin tasa propia usa la general", () => {
    expect(tasaDe(MIXTA, "PYG")).toBe(4.5);
    expect(interesAcumulado(1_000_000, 30, MIXTA, "PYG")).toBeCloseTo(45_000, 6);
  });

  it("sin moneda devuelve la general", () => {
    expect(tasaDe(MIXTA)).toBe(4.5);
  });

  it("una moneda puede tener tasa cero con la general encendida", () => {
    const config: ConfigInteres = { tasaMensual: 4.5, porMoneda: { USD: 0 } };

    expect(interesAcumulado(1_000, 90, config, "USD")).toBe(0);
    expect(calculaInteres(config, "USD")).toBe(false);
    expect(calculaInteres(config, "PYG")).toBe(true);
  });

  it("una moneda puede tener tasa con la general apagada", () => {
    const config: ConfigInteres = { tasaMensual: 0, porMoneda: { USD: 1.2 } };

    // Sin moneda, la pregunta es por la organizacion entera: hay algo que mostrar.
    expect(calculaInteres(config)).toBe(true);
    expect(calculaInteres(config, "PYG")).toBe(false);
    expect(interesPorDia(1_000, config, "USD")).toBeCloseTo(0.4, 6);
  });

  it("una tasa rota en una moneda cae en la general, no en NaN", () => {
    const config = {
      tasaMensual: 4.5,
      porMoneda: { USD: Number.NaN },
    } as ConfigInteres;

    expect(Number.isNaN(interesAcumulado(1_000, 30, config, "USD"))).toBe(false);
    expect(interesAcumulado(1_000, 30, config, "USD")).toBe(0);
  });
});

describe("interesDeCuotas", () => {
  const CONFIG: ConfigInteres = { tasaMensual: 3, porMoneda: {} };

  it("ignora las cuotas que todavia no vencieron", () => {
    const { interes, base } = interesDeCuotas(
      [
        { saldo: 1_000, diasMora: 30 },
        { saldo: 1_000, diasMora: 0 },
        { saldo: 1_000, diasMora: -40 },
      ],
      CONFIG,
    );

    // 3 % de 1.000 en 30 dias, una sola vez: la base es la cuota vencida.
    expect(interes).toBeCloseTo(30, 6);
    expect(base).toBe(1_000);
  });

  it("cada cuota corre con sus propios dias, no con los de la mas vieja", () => {
    const cuotas = [
      { saldo: 1_000, diasMora: 300 },
      { saldo: 1_000, diasMora: 30 },
    ];

    const { interes } = interesDeCuotas(cuotas, CONFIG);

    expect(interes).toBeCloseTo(
      interesAcumulado(1_000, 300, CONFIG) + interesAcumulado(1_000, 30, CONFIG),
      6,
    );
    // Lo que hacia la ficha antes: 2.000 de saldo por los 300 dias del peor.
    expect(interes).toBeLessThan(interesAcumulado(2_000, 300, CONFIG));
  });

  it("lo que corre por dia es sobre lo vencido, no sobre la deuda entera", () => {
    const { porDia } = interesDeCuotas(
      [
        { saldo: 1_000, diasMora: 10 },
        { saldo: 9_000, diasMora: 0 },
      ],
      CONFIG,
    );

    expect(porDia).toBeCloseTo(interesPorDia(1_000, CONFIG), 6);
  });

  it("usa la tasa de la moneda pedida", () => {
    const config: ConfigInteres = { tasaMensual: 4.5, porMoneda: { USD: 1.2 } };
    const cuotas = [{ saldo: 1_000, diasMora: 30 }];

    expect(interesDeCuotas(cuotas, config, "USD").interes).toBeCloseTo(12, 6);
    expect(interesDeCuotas(cuotas, config, "PYG").interes).toBeCloseTo(45, 6);
  });

  it("sin cuotas vencidas o sin tasa devuelve ceros, no NaN", () => {
    expect(interesDeCuotas([], CONFIG)).toEqual({ interes: 0, base: 0, porDia: 0 });
    expect(
      interesDeCuotas([{ saldo: 1_000, diasMora: 90 }], INTERES_POR_DEFECTO),
    ).toEqual({ interes: 0, base: 0, porDia: 0 });
  });
});
