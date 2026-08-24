import Image from "next/image";

/**
 * Mitad izquierda de las pantallas de auth: fondo contorno, logo en blanco, tagline
 * y un dato de producto.
 *
 * El logo se pinta de blanco con `brightness-0 invert` porque los dos SVG del kit
 * vienen en #2A2A35 y desaparecerian sobre este fondo. Es un parche: lo correcto es
 * exportar una variante blanca desde `Pand Brand/Pand_logo_editable.svg`.
 */
export function BrandPanel() {
  return (
    <aside className="relative hidden bg-pand-contorno p-12 lg:flex lg:flex-col lg:justify-between">
      {/* Filete celeste del manual de marca */}
      <span className="absolute inset-y-0 left-0 w-1 bg-pand-celeste" aria-hidden />

      <Image
        src="/brand/logo.svg"
        alt="Pand"
        width={1400}
        height={420}
        priority
        className="h-10 w-auto brightness-0 invert"
      />

      <div>
        <p className="max-w-md text-3xl font-extrabold leading-tight tracking-tight text-white">
          Cobranzas al día,
          <br />
          cartera bajo control.
        </p>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-pand-gris">
          Software de cobranzas con IA para equipos de 3 a 300 operadores.
        </p>
      </div>

      <div className="border-t border-white/10 pt-6">
        <p className="mono text-4xl font-medium text-pand-celeste">68,4 %</p>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-pand-gris">
          Recupero promedio
        </p>
      </div>
    </aside>
  );
}
