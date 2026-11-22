import { clasificarColumna } from "@/lib/import/parse-values";
import type { TipoDeCampo } from "@/lib/config/settings";

/**
 * Valores iniciales para crear un campo propio desde la pantalla de mapeo.
 *
 * Existe para que crear el campo sea una decisión y no un formulario: la
 * columna ya dice cómo se llama y qué trae, así que el diálogo se abre
 * contestado y en el caso normal solo hay que confirmar.
 */

/**
 * Convierte el encabezado del archivo en un nombre presentable.
 *
 * "SUCURSAL" -> "Sucursal", "Aux_Cobranza" -> "Aux cobranza". Es solo el valor
 * inicial: la persona lo corrige si no le gusta. Importa porque el encabezado
 * crudo de un ERP, en mayúsculas y con guiones bajos, queda feo después en la
 * ficha del deudor y en los reportes.
 *
 * Un encabezado que ya viene escrito como texto normal ("Aux_Cobranza") se
 * respeta: solo se bajan a minúscula los que vienen todos en mayúsculas, que es
 * grito del sistema de origen y no una decisión de nadie.
 */
export function etiquetaDesdeEncabezado(header: string): string {
  const limpio = header.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
  if (!limpio) return header.slice(0, 60);

  const normal = /[a-záéíóúüñ]/.test(limpio) ? limpio : limpio.toLowerCase();
  return (normal.charAt(0).toUpperCase() + normal.slice(1)).slice(0, 60);
}

/**
 * Tipo sugerido para el campo nuevo, mirando lo que trae la columna.
 *
 * La fracción ("13/35") va a texto a propósito: es un identificador, no un
 * número con el que se hagan cuentas.
 */
export function tipoDesdeMuestra(valores: unknown[]): TipoDeCampo {
  switch (clasificarColumna(valores)) {
    case "fecha":
      return "fecha";
    case "monto":
    case "montocero":
    case "numero":
      return "numero";
    default:
      return "texto";
  }
}
