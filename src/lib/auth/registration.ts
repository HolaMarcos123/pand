/**
 * Cerrojo del alta pública.
 *
 * Mientras Pand esté desplegado en una URL adivinable y sin landing, cualquiera que
 * llegue puede crearse una organización con 14 días de trial. Esto lo cierra hasta
 * que salga a vender.
 *
 * **El default es cerrado, y es deliberado.** Si la variable no está definida —un
 * entorno nuevo, un preview, alguien que se olvidó de configurarla— el registro queda
 * cerrado. La alternativa (abierto por defecto) significa que un olvido abre el alta
 * en producción sin que nadie se entere, y ese es el error que no se puede permitir.
 *
 * No es `NEXT_PUBLIC_`: no hay razón para que el navegador sepa esto, y el chequeo
 * que importa corre en el servidor.
 */
export function isRegistrationOpen(): boolean {
  return process.env.REGISTRATION_OPEN === "true";
}
