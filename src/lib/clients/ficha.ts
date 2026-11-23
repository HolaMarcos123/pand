import type { ClientDetail } from "@/lib/queries/tasks";

export type Cuota = ClientDetail["invoices"][number];
export type Propio = Cuota["propios"][number];

/**
 * Los campos propios que valen lo mismo en todas las cuotas del grupo.
 *
 * El ERP exporta una fila por cuota, así que el teléfono, el cónyuge o la
 * sucursal vienen repetidos en las 48 filas del crédito. Mostrarlos en cada
 * cuota es la misma línea 48 veces; lo que cambia de una cuota a otra —el saldo,
 * el tramo de atraso— sí es de la cuota.
 *
 * Con una sola cuota no hay nada que deducir: todo parecería constante.
 */
export function constantes(cuotas: Cuota[]): { datos: Propio[]; etiquetas: Set<string> } {
  if (cuotas.length < 2) return { datos: [], etiquetas: new Set() };

  const valores = new Map<string, Set<string>>();
  const primero = new Map<string, Propio>();

  for (const cuota of cuotas) {
    for (const propio of cuota.propios) {
      let vistos = valores.get(propio.label);
      if (!vistos) {
        vistos = new Set();
        valores.set(propio.label, vistos);
        // El orden es el que eligió la organización en Config, y la consulta ya
        // lo respeta: alcanza con quedarse con la primera aparición.
        primero.set(propio.label, propio);
      }
      vistos.add(propio.valor);
    }
  }

  const etiquetas = new Set(
    [...valores].filter(([, vistos]) => vistos.size === 1).map(([label]) => label),
  );

  return {
    datos: [...primero.values()].filter((p) => etiquetas.has(p.label)),
    etiquetas,
  };
}

/**
 * Las cuotas agrupadas por operación.
 *
 * Un deudor puede tener dos créditos abiertos a la vez, cada uno con sus 48
 * cuotas. Listarlas todas seguidas obliga a leer el número de operación en cada
 * línea para saber de cuál es.
 */
export function porOperacion(cuotas: Cuota[]) {
  const grupos = new Map<string, Cuota[]>();
  for (const cuota of cuotas) {
    const clave = cuota.loanNumber || "";
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(cuota);
    else grupos.set(clave, [cuota]);
  }

  return [...grupos].map(([loanNumber, suyas]) => ({
    loanNumber,
    cuotas: suyas,
    // El producto y la moneda son de la operación, no de cada cuota.
    product: suyas.find((c) => c.product)?.product ?? null,
    monedas: [...new Set(suyas.map((c) => c.currency))],
    portfolioName: suyas.find((c) => c.portfolioName)?.portfolioName ?? null,
  }));
}

