/**
 * Normaliza un encabezado de planilla para poder compararlo con los alias.
 *
 * Se sacan los conectores ("de", "del", "la"...) **antes** de borrar los separadores,
 * que es el único momento en que todavía se sabe dónde termina una palabra. Sin eso,
 * "Forma de Pago" queda como `formadepago` y no matchea contra `formapago`: fue
 * exactamente el bug que dejó todos los medios de pago en OTHER, y el mismo que hacía
 * fallar "Fecha de Vencimiento" contra `fechavencimiento`.
 *
 * El límite de palabra importa: "Detalle" y "Deuda" contienen "de" pero no como
 * palabra suelta, así que no se tocan.
 */
export function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(de|del|la|el|los|las|por)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Empareja encabezados con campos sin repetir columnas.
 *
 * Si dos columnas matchean el mismo campo, gana la primera y la segunda queda sin
 * asignar para que decida el usuario: autocompletar las dos y pisar una sería peor
 * que no sugerir nada.
 */
export function matchHeaders<K extends string>(
  headers: string[],
  aliases: Record<K, string[]>,
  opciones: {
    /** Campos ya resueltos por otra via, que no se vuelven a buscar. */
    yaAsignado?: Partial<Record<K, string>>;
    /**
     * Veto por tipo de dato. El nombre de un encabezado puede mentir —una
     * columna "CUOTA" que trae "66,00" es plata y no el numero de cuota— asi
     * que quien llama puede rechazar una coincidencia mirando lo que la columna
     * trae de verdad.
     */
    compatible?: (key: K, header: string) => boolean;
  } = {},
): Partial<Record<K, string>> {
  const mapping: Partial<Record<K, string>> = { ...opciones.yaAsignado };
  const used = new Set<string>(Object.values(mapping) as string[]);

  for (const [key, list] of Object.entries(aliases) as [K, string[]][]) {
    if (mapping[key]) continue;

    const match = headers.find((header) => {
      if (used.has(header)) return false;
      if (opciones.compatible && !opciones.compatible(key, header)) return false;
      const normalized = normalizeHeader(header);
      return list.some((alias) => coincide(normalized, alias));
    });

    if (match) {
      mapping[key] = match;
      used.add(match);
    }
  }

  return mapping;
}

/**
 * Si un encabezado normalizado corresponde a un alias.
 *
 * El prefijo es necesario —"TELEF1" tiene que caer en el alias "telef1" y
 * "FACTURA_NRO" en "factura"— pero suelto se lleva columnas que no tienen nada
 * que ver: "CIUDAD" empieza con "ci" y terminaba mapeada a CI/RUC, dejando el
 * documento real sin asignar. El mismo problema ya habia obligado a sacar el
 * alias "mon", que se llevaba "MONTO_APLICADO".
 *
 * Asi que un prefijo solo vale si corta donde corta una palabra: lo que sigue
 * es un numero ("telef" + "1"), o el alias es largo y especifico por si mismo.
 * Para lo demas tiene que coincidir entero.
 */
const PREFIJO_SEGURO = 5;

function coincide(normalized: string, alias: string): boolean {
  if (normalized === alias) return true;
  if (!normalized.startsWith(alias)) return false;

  const resto = normalized.slice(alias.length);
  return /^\d/.test(resto) || alias.length >= PREFIJO_SEGURO;
}
