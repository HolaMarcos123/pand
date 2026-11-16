import { prisma } from "@/lib/prisma";

/**
 * El identificador corto de una organización, derivado de su nombre.
 *
 * Vive acá y no dentro de las acciones de registro porque ahora lo necesitan dos
 * caminos: el alta pública y el alta desde el backoffice. Dos implementaciones
 * del mismo slug terminarían generando identificadores distintos para el mismo
 * nombre, y el slug es parte de la identidad de la cuenta.
 */
export function slugify(value: string): string {
  const base = value
    .normalize("NFD")
    // Se sacan los diacríticos: "Créditos Ñandutí" → "creditos-nanduti".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  return base || "org";
}

/**
 * El slug libre más parecido al pedido: `prestigio`, `prestigio-2`, `prestigio-3`.
 *
 * Hay una carrera posible entre el chequeo y el insert, y no se resuelve acá: la
 * tabla tiene un unique sobre slug, así que en el peor caso el insert falla y
 * quien llama lo trata como un error. Preferible eso a tomar un lock.
 */
export async function uniqueSlug(base: string): Promise<string> {
  if (!(await prisma.organization.findUnique({ where: { slug: base } }))) {
    return base;
  }

  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base}-${n}`;
    if (!(await prisma.organization.findUnique({ where: { slug: candidate } }))) {
      return candidate;
    }
  }

  return `${base}-${Date.now().toString(36)}`;
}
