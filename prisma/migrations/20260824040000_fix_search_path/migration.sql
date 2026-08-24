-- calc_client_priority quedo con search_path mutable. No accede a ninguna tabla, asi
-- que el riesgo real es bajo, pero deja el linter de Supabase en verde y cierra la
-- puerta a un secuestro de search_path si mas adelante la funcion crece.
-- Los identificadores que usa ya estan calificados con public., asi que vaciarlo no
-- rompe nada.
ALTER FUNCTION public.calc_client_priority(integer, numeric, numeric) SET search_path = '';
