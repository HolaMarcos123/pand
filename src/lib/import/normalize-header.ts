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
): Partial<Record<K, string>> {
  const mapping: Partial<Record<K, string>> = {};
  const used = new Set<string>();

  for (const [key, list] of Object.entries(aliases) as [K, string[]][]) {
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      const normalized = normalizeHeader(header);
      return list.some(
        (alias) => normalized === alias || normalized.startsWith(alias),
      );
    });

    if (match) {
      mapping[key] = match;
      used.add(match);
    }
  }

  return mapping;
}
