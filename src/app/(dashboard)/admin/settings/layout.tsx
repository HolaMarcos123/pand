import { SettingsNav } from "./settings-nav";

/**
 * Marco de Configuración: navegación de secciones a la izquierda, contenido a la
 * derecha. Es la forma que ya tienen las configuraciones de cualquier producto
 * parecido, y existe por una razón concreta: la configuración crece sin parar, y
 * una sola página larga termina siendo imposible de recorrer.
 *
 * El rol se valida en cada página, no acá. Ver el comentario de `admin/layout`:
 * este layout y la página se renderizan en paralelo, así que un corte acá no
 * impide que la página consulte y mande los datos en el payload de RSC.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <SettingsNav />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
