import { redirect } from "next/navigation";

/** /admin/settings no tiene contenido propio: abre la primera sección. */
export default function SettingsIndexPage() {
  redirect("/admin/settings/organizacion");
}
