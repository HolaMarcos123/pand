import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isPlatformAdmin } from "@/lib/platform/access";

/**
 * Quién entra al backoffice.
 *
 * Es el permiso más alto del producto: ve y modifica los datos de todas las
 * empresas clientes. Estos tests fijan la única propiedad que no se puede
 * relajar nunca — que el default sea cerrado — y los bordes del parseo, que es
 * donde una lista escrita a mano se rompe.
 */

const original = process.env.PLATFORM_ADMIN_EMAILS;

beforeEach(() => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
});

afterEach(() => {
  if (original === undefined) delete process.env.PLATFORM_ADMIN_EMAILS;
  else process.env.PLATFORM_ADMIN_EMAILS = original;
});

describe("el default es cerrado", () => {
  it("sin la variable, nadie es administrador de plataforma", () => {
    // Un despliegue donde se olvidaron de configurarla deja el backoffice
    // inaccesible. Molesto, pero seguro. Al revés sería una catástrofe callada.
    expect(isPlatformAdmin("marcos@pand.app")).toBe(false);
  });

  it("con la variable vacía, tampoco", () => {
    for (const valor of ["", "   ", ",", ",,,", " , , "]) {
      process.env.PLATFORM_ADMIN_EMAILS = valor;
      expect(isPlatformAdmin("marcos@pand.app"), `con ${JSON.stringify(valor)}`).toBe(
        false,
      );
    }
  });

  it("sin email no hay acceso", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "marcos@pand.app";
    for (const valor of [null, undefined, "", "   "]) {
      expect(isPlatformAdmin(valor)).toBe(false);
    }
  });
});

describe("la lista", () => {
  it("deja pasar a los que están y a nadie más", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "marcos@pand.app,socia@pand.app";
    expect(isPlatformAdmin("marcos@pand.app")).toBe(true);
    expect(isPlatformAdmin("socia@pand.app")).toBe(true);
    expect(isPlatformAdmin("operador1@pand.demo")).toBe(false);
  });

  it("tolera espacios y mayúsculas, que es como se escriben estas listas", () => {
    process.env.PLATFORM_ADMIN_EMAILS = "  Marcos@Pand.App ,  socia@pand.app  ";
    expect(isPlatformAdmin("marcos@pand.app")).toBe(true);
    expect(isPlatformAdmin("  MARCOS@PAND.APP  ")).toBe(true);
  });

  it("no hace coincidencias parciales", () => {
    // El riesgo evidente de una lista de texto: que "pand.app" deje entrar a
    // cualquiera de ese dominio, o que un prefijo alcance.
    process.env.PLATFORM_ADMIN_EMAILS = "marcos@pand.app";
    for (const intruso of [
      "marcos@pand.app.attacker.com",
      "otro@pand.app",
      "pand.app",
      "marcos",
      "xmarcos@pand.app",
    ]) {
      expect(isPlatformAdmin(intruso), intruso).toBe(false);
    }
  });

  it("se lee en cada llamada, no se congela al importar el módulo", () => {
    // Importa porque el valor se evalúa en el servidor y una copia cacheada al
    // importar haría que cambiar la variable no tenga efecto hasta un reinicio.
    process.env.PLATFORM_ADMIN_EMAILS = "uno@pand.app";
    expect(isPlatformAdmin("uno@pand.app")).toBe(true);

    process.env.PLATFORM_ADMIN_EMAILS = "dos@pand.app";
    expect(isPlatformAdmin("uno@pand.app")).toBe(false);
    expect(isPlatformAdmin("dos@pand.app")).toBe(true);
  });
});
