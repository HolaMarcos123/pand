/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    /**
     * Limite del body de los server actions.
     *
     * El default es 1 MB, y el importador de carteras manda las filas mapeadas
     * como argumento de un server action: un lote de BATCH_SIZE filas con
     * descripciones largas puede acercarse a ese techo y el request falla
     * entero. 4 MB deja margen sin volverse una puerta abierta: la cantidad de
     * filas por lote la acota zod en row-schema.ts.
     */
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
