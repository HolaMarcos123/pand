import { describe, expect, it } from "vitest";

import { etiquetaDesdeEncabezado, tipoDesdeMuestra } from "@/lib/import/campo-nuevo";

describe("etiquetaDesdeEncabezado", () => {
  it("baja a minuscula el encabezado que viene todo en mayusculas", () => {
    expect(etiquetaDesdeEncabezado("SUCURSAL")).toBe("Sucursal");
    expect(etiquetaDesdeEncabezado("MONTO_APLICADO")).toBe("Monto aplicado");
  });

  it("respeta el encabezado que ya viene escrito como texto", () => {
    expect(etiquetaDesdeEncabezado("Aux_Cobranza")).toBe("Aux Cobranza");
    expect(etiquetaDesdeEncabezado("zona de cobro")).toBe("Zona de cobro");
  });

  it("colapsa separadores y espacios de más", () => {
    expect(etiquetaDesdeEncabezado("NR__FACTURA")).toBe("Nr factura");
    expect(etiquetaDesdeEncabezado("  COD-SUC .  2 ")).toBe("Cod suc 2");
  });

  it("no rompe con un encabezado que es solo separadores", () => {
    expect(etiquetaDesdeEncabezado("___")).toBe("___");
    expect(etiquetaDesdeEncabezado("")).toBe("");
  });

  it("corta en 60 para respetar el tope de la etiqueta", () => {
    expect(etiquetaDesdeEncabezado("A".repeat(80))).toHaveLength(60);
  });
});

describe("tipoDesdeMuestra", () => {
  it("reconoce la fecha", () => {
    expect(tipoDesdeMuestra(["2026-08-15", "2026-09-15"])).toBe("fecha");
  });

  it("reconoce la plata y el entero pelado como numero", () => {
    expect(tipoDesdeMuestra(["1.016.488,00", "66,00"])).toBe("numero");
    expect(tipoDesdeMuestra(["12", "340"])).toBe("numero");
  });

  it("manda la fraccion a texto: es un identificador, no un numero", () => {
    expect(tipoDesdeMuestra(["13/35", "1/60"])).toBe("texto");
  });

  it("manda el texto libre a texto", () => {
    expect(tipoDesdeMuestra(["Encarnación", "Ciudad del Este"])).toBe("texto");
    expect(tipoDesdeMuestra(["Armando Barreto Ojeda"])).toBe("texto");
  });

  it("trata la columna vacia como texto", () => {
    expect(tipoDesdeMuestra([])).toBe("texto");
    expect(tipoDesdeMuestra([null, undefined, ""])).toBe("texto");
  });

  it("una columna toda en cero sigue siendo un numero", () => {
    // Para el adivinador del mapeo "montocero" es sospechoso, porque tomarla
    // como el monto de la deuda deja la cartera en cero. Como campo propio no:
    // MONTO_APLICADO en cero es un numero y se guarda como tal.
    expect(tipoDesdeMuestra(["0,00", "0,00"])).toBe("numero");
  });
});
