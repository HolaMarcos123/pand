-- Automatismos de la segunda mitad del P01:
--   1. Propagar next_action_at desde management_actions hacia clients.
--   2. Recalcular days_overdue en invoices, todos los dias.
--   3. Derivar clients.priority de la mora y la deuda.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ─────────────── 1. Propagar el proximo seguimiento ───────────────

-- SECURITY INVOKER (el default) a proposito: la policy de clients ya permite tocar
-- un cliente de la propia organizacion, y el UPDATE ademas exige que coincida el
-- organization_id de la gestion. No hace falta elevar privilegios.
CREATE OR REPLACE FUNCTION public.sync_client_next_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.next_action_at IS NOT NULL THEN
    UPDATE public.clients
       SET next_action_at = NEW.next_action_at,
           updated_at     = now()
     WHERE id              = NEW.client_id
       AND organization_id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Solo INSERT, como pide el brief. Las gestiones son un registro historico: no se
-- editan, se agrega una nueva.
CREATE TRIGGER management_actions_sync_next_action
AFTER INSERT ON public.management_actions
FOR EACH ROW
EXECUTE FUNCTION public.sync_client_next_action();

-- ─────────────── 2. Prioridad derivada ───────────────

-- Los tramos salen de la UI del brief: coral +90, naranja 61-90, despues normal.
-- El monto escala un nivel si supera el umbral de la organizacion. Ese umbral vive
-- en organizations.settings->>'priority_debt_threshold' en vez de estar hardcodeado,
-- porque un numero fijo en guaranies no sirve para un tenant que factura en USD.
-- Si no esta configurado, el monto no influye.
CREATE OR REPLACE FUNCTION public.calc_client_priority(
  p_days_overdue   integer,
  p_total_debt     numeric,
  p_debt_threshold numeric
)
RETURNS public."ClientPriority"
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT (
    CASE
      WHEN p_days_overdue > 90 THEN 'CRITICAL'
      WHEN p_days_overdue >= 61 THEN
        CASE WHEN p_debt_threshold IS NOT NULL AND p_total_debt >= p_debt_threshold
             THEN 'CRITICAL' ELSE 'HIGH' END
      WHEN p_days_overdue >= 31 THEN
        CASE WHEN p_debt_threshold IS NOT NULL AND p_total_debt >= p_debt_threshold
             THEN 'HIGH' ELSE 'MEDIUM' END
      ELSE
        CASE WHEN p_debt_threshold IS NOT NULL AND p_total_debt >= p_debt_threshold
             THEN 'MEDIUM' ELSE 'LOW' END
    END
  )::public."ClientPriority"
$fn$;

-- ─────────────── 3. Recalculo diario ───────────────

-- NO toca clients.total_debt: ese valor lo mantienen el importador de carteras y el
-- flujo de cobros. Recalcularlo desde invoices pisaria la deuda de los tenants que
-- cargan saldo a nivel cliente sin detalle de facturas.
CREATE OR REPLACE FUNCTION public.refresh_overdue_and_priority()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- a) Dias de mora, solo sobre facturas abiertas. Las pagadas o anuladas se
  --    congelan en el valor que tenian.
  UPDATE public.invoices
     SET days_overdue = GREATEST(0, (CURRENT_DATE - due_date)),
         updated_at   = now()
   WHERE status IN ('PENDING', 'PARTIAL')
     AND days_overdue IS DISTINCT FROM GREATEST(0, (CURRENT_DATE - due_date));

  -- b) Prioridad, a partir de la factura mas atrasada del cliente.
  UPDATE public.clients c
     SET priority   = public.calc_client_priority(agg.max_dias, c.total_debt, agg.umbral),
         updated_at = now()
    FROM (
      SELECT cl.id,
             COALESCE(MAX(i.days_overdue), 0) AS max_dias,
             NULLIF(o.settings ->> 'priority_debt_threshold', '')::numeric AS umbral
        FROM public.clients cl
        JOIN public.organizations o ON o.id = cl.organization_id
        LEFT JOIN public.invoices i
               ON i.client_id = cl.id
              AND i.status IN ('PENDING', 'PARTIAL')
       WHERE cl.status NOT IN ('PAID', 'LOST')
       GROUP BY cl.id, o.settings
    ) agg
   WHERE c.id = agg.id
     -- Solo escribe si cambia, para no inflar updated_at de toda la cartera a diario.
     AND c.priority IS DISTINCT FROM
         public.calc_client_priority(agg.max_dias, c.total_debt, agg.umbral);
END;
$fn$;

-- Es SECURITY DEFINER y reescribe cartera entera: no se expone por PostgREST.
REVOKE EXECUTE ON FUNCTION public.refresh_overdue_and_priority() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_overdue_and_priority() FROM anon;
REVOKE EXECUTE ON FUNCTION public.refresh_overdue_and_priority() FROM authenticated;

-- 03:15 UTC = 23:15/00:15 en Paraguay. Corre antes de los recordatorios de las 7:00
-- del P09, asi que esos emails ya salen con la mora del dia.
-- cron.schedule hace upsert por nombre, o sea que reaplicar esto no duplica el job.
SELECT cron.schedule(
  'pand-refresh-overdue',
  '15 3 * * *',
  $job$SELECT public.refresh_overdue_and_priority()$job$
);
