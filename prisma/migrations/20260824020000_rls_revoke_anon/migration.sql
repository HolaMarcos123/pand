-- Supabase aplica default privileges que otorgan EXECUTE sobre toda funcion nueva
-- del schema public a anon, authenticated y service_role. Por eso el REVOKE FROM
-- PUBLIC de la migracion anterior no alcanzo: los grants a esos roles son explicitos.
--
-- anon no tiene nada que hacer con esta funcion (sin sesion, auth.uid() es NULL y
-- devuelve NULL), asi que se le saca y deja de estar expuesta en /rest/v1/rpc/.
REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM anon;

-- authenticated conserva el permiso a proposito: las policies invocan la funcion
-- como el rol que hace la consulta, asi que sin este grant RLS bloquearia todo.
-- No filtra nada: a cada usuario le devuelve el id de su propia organizacion.
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
