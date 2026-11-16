import { z } from "zod";

/**
 * Un identificador de fila, validado como lo valida Postgres.
 *
 * Esto existe por un bug real: suspender una organización desde el backoffice
 * fallaba con "Datos inválidos" y nada más. El id era
 * `44444444-4444-4444-4444-444444444444`, que Postgres acepta sin chistar como
 * `uuid` pero `z.string().uuid()` de Zod 4 rechaza, porque exige los bits de
 * versión y variante de la RFC 4122 y ese id no los tiene.
 *
 * La diferencia importa: en la base hay —y va a seguir habiendo— ids que no son
 * UUID v4 canónicos. Los de un seed escrito a mano, los que vengan de una
 * migración desde el sistema viejo de un cliente, los de una importación. Todos
 * son filas perfectamente válidas que la aplicación tiene que poder tocar.
 *
 * Validar más estricto que la base no agrega seguridad: el id viaja como
 * parámetro, así que no hay inyección posible, y de todas formas cada consulta
 * filtra por organización. Lo único que agrega es un rechazo incomprensible
 * sobre datos legítimos.
 *
 * `z.guid()` acepta el formato 8-4-4-4-12 en hexadecimal, que es exactamente lo
 * que acepta el tipo `uuid` de Postgres.
 */
export const idSchema = z.guid();

/** Lo mismo, para campos opcionales que pueden venir en null. */
export const idNullableSchema = z.guid().nullable();
