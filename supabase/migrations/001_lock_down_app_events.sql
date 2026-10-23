-- 001_lock_down_app_events.sql
-- Supabase project: mgalwgarvsjgalaqyeok (shared with holgry; touches only app_events)
--
-- Before: the anon key (public, shipped in index.html) could SELECT every row of
-- app_events, so anyone could read visitor cities, countries and timestamps.
-- After:
--   * anon can only INSERT visit/install rows, into the columns the hub sends
--     (id/created_at stay server-generated), with values pinned by WITH CHECK.
--   * nobody but service_role can read rows; the stats page reads aggregates
--     through /api/stats (admin secret) -> get_app_event_stats() below.
--
-- Run the whole file in the Supabase SQL editor. It is idempotent.

BEGIN;

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;

-- Drop whatever policies exist today (the permissive SELECT among them) so the
-- end state is exactly what this file defines.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'app_events'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.app_events', p.policyname);
  END LOOP;
END $$;

-- Privileges are the first gate, RLS the second: even if a SELECT policy is
-- added by mistake later, anon/authenticated hold no SELECT grant.
REVOKE ALL ON public.app_events FROM anon, authenticated;
GRANT INSERT (event_type, app, platform, country, city) ON public.app_events TO anon;

CREATE POLICY app_events_anon_insert ON public.app_events
  FOR INSERT TO anon
  WITH CHECK (
    app = 'bombguard'
    AND event_type IN ('visit', 'install')
    AND (platform IS NULL OR platform IN ('ios', 'android', 'desktop'))
    AND (country IS NULL OR char_length(country) <= 100)
    AND (city IS NULL OR char_length(city) <= 100)
  );

-- Aggregates for the owner-only stats page. Returns counts only, never rows.
-- SECURITY INVOKER: it runs as service_role (the only grantee), which already
-- bypasses RLS, so it needs no elevated rights of its own.
CREATE OR REPLACE FUNCTION public.get_app_event_stats(p_tz text DEFAULT 'UTC')
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH e AS (
    SELECT event_type,
           coalesce(platform, 'desktop') AS platform,
           country,
           city,
           (created_at AT TIME ZONE p_tz)::date AS day
    FROM public.app_events
    WHERE app = 'bombguard'
  ),
  t AS (SELECT (now() AT TIME ZONE p_tz)::date AS today)
  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'visits',         count(*) FILTER (WHERE event_type = 'visit'),
        'installs',       count(*) FILTER (WHERE event_type = 'install'),
        'visits_today',   count(*) FILTER (WHERE event_type = 'visit'   AND day = t.today),
        'installs_today', count(*) FILTER (WHERE event_type = 'install' AND day = t.today)
      )
      FROM e, t
    ),
    -- last 14 days including today, zero-filled
    'daily', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day, 'visits', d.visits, 'installs', d.installs) ORDER BY d.day), '[]'::jsonb)
      FROM (
        SELECT g.day::date AS day,
               count(e.day) FILTER (WHERE e.event_type = 'visit')   AS visits,
               count(e.day) FILTER (WHERE e.event_type = 'install') AS installs
        FROM t, generate_series(t.today - 13, t.today, interval '1 day') AS g(day)
        LEFT JOIN e ON e.day = g.day::date
        GROUP BY g.day
      ) d
    ),
    'platforms', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'platform', p.platform, 'visits', p.visits, 'installs', p.installs)
               ORDER BY p.visits + p.installs DESC), '[]'::jsonb)
      FROM (
        SELECT platform,
               count(*) FILTER (WHERE event_type = 'visit')   AS visits,
               count(*) FILTER (WHERE event_type = 'install') AS installs
        FROM e GROUP BY platform
      ) p
    ),
    'locations', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'city', l.city, 'country', l.country, 'visits', l.visits, 'installs', l.installs)
               ORDER BY l.visits + l.installs DESC), '[]'::jsonb)
      FROM (
        SELECT city, country,
               count(*) FILTER (WHERE event_type = 'visit')   AS visits,
               count(*) FILTER (WHERE event_type = 'install') AS installs
        FROM e
        WHERE country IS NOT NULL
        GROUP BY city, country
        ORDER BY count(*) DESC
        LIMIT 10
      ) l
    )
  );
$$;

-- Supabase grants EXECUTE on new functions to anon/authenticated by default,
-- so revoke those explicitly, not just PUBLIC.
REVOKE EXECUTE ON FUNCTION public.get_app_event_stats(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_event_stats(text) TO service_role;

COMMIT;

-- ── Verify (run after the migration) ────────────────────────────────────────
-- Policies: expect exactly one row, app_events_anon_insert / INSERT / {anon}
--   SELECT policyname, cmd, roles FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'app_events';
-- Grants: expect anon INSERT only (column-level), nothing for authenticated
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema = 'public' AND table_name = 'app_events'
--     AND grantee IN ('anon', 'authenticated');
--   SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
--   WHERE table_schema = 'public' AND table_name = 'app_events' AND grantee = 'anon';
-- Aggregates:
--   SELECT public.get_app_event_stats('America/New_York');
