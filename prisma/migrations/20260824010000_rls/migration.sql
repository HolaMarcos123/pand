-- Aislamiento multi-tenant por Row Level Security.
--
-- Modelo elegido: la policy resuelve el tenant con un subquery contra public.users
-- en vez de leer un claim del JWT. No hay nada que configurar en Supabase y no se
-- puede desincronizar: si un usuario cambia de organizacion, la proxima consulta
-- ya ve el valor nuevo.
--
-- Ojo con el alcance: los roles postgres y service_role tienen BYPASSRLS, asi que
-- Prisma NO pasa por estas policies. Esto protege el camino de supabase-js (anon /
-- authenticated), que es el que queda expuesto en el browser. Las queries de Prisma
-- tienen que seguir filtrando por organizationId en el codigo.

-- ─────────────── 1. Helper ───────────────

-- SECURITY DEFINER a proposito: sin esto, la policy de public.users tendria que
-- leer public.users y Postgres entraria en recursion infinita. Al correr como
-- owner (postgres, que tiene BYPASSRLS) la lectura interna no dispara RLS.
-- search_path vacio + nombres calificados: evita secuestro de search_path.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT organization_id FROM public.users WHERE id = (SELECT auth.uid())
$$;

REVOKE EXECUTE ON FUNCTION public.current_org_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;

-- ─────────────── 2. Activar RLS ───────────────

ALTER TABLE public.organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portfolios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.management_actions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations    ENABLE ROW LEVEL SECURITY;

-- Tabla interna de Prisma: RLS activo y sin policies, o sea inalcanzable desde
-- PostgREST. Prisma la escribe como postgres, que ignora RLS.
ALTER TABLE public._prisma_migrations  ENABLE ROW LEVEL SECURITY;

-- ─────────────── 3. Policies ───────────────

-- organizations se filtra por su propio id, no por organization_id.
CREATE POLICY organizations_tenant_isolation ON public.organizations
  FOR ALL TO authenticated
  USING (id = public.current_org_id())
  WITH CHECK (id = public.current_org_id());

CREATE POLICY users_tenant_isolation ON public.users
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY portfolios_tenant_isolation ON public.portfolios
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY clients_tenant_isolation ON public.clients
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY invoices_tenant_isolation ON public.invoices
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY management_actions_tenant_isolation ON public.management_actions
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY payments_tenant_isolation ON public.payments
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY integration_configs_tenant_isolation ON public.integration_configs
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

CREATE POLICY ai_conversations_tenant_isolation ON public.ai_conversations
  FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
