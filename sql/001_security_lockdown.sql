-- =====================================================================================
-- 001_security_lockdown.sql
--
-- Closes the database to the public. The web app no longer talks to Supabase directly:
-- every read and write goes through the API (server.js), which uses the service role key
-- and enforces permissions. That means the public "anon" key, which used to be embedded in
-- index.html, must not be able to read or write anything.
--
-- Safe to run more than once. Run it in the Supabase SQL editor.
-- After running it, rotate the anon key if you want to be thorough (Settings > API).
-- =====================================================================================

do $$
declare
    t text;
    tables text[] := array[
        'app_settings',
        'audit_logs',
        'backups',
        'banned_users',
        'base_access_discord_servers',
        'base_access_groups',
        'board_cards',
        'board_lists',
        'broadcasts',
        'discord_links',
        'discord_oauth_states',
        'game_stat_snapshots',
        'games',
        'group_eligibility_cache',
        'hr_sessions',
        'oauth_states',
        'onboarding_links',
        'payment_methods',
        'payment_requests',
        'payment_runs',
        'rate_bands',
        'recruit_onboarding_flows',
        'recruit_push_subscriptions',
        'recruit_sessions',
        'recruitment_positions',
        'recruitment_tickets',
        'required_groups',
        'roles',
        'security_events',
        'security_holds',
        'skillsets',
        'staff_onboarding_progress',
        'staff_warnings',
        'team_games',
        'team_skillsets',
        'team_tasks',
        'teams',
        'user_assignments',
        'user_flags',
        'user_role_assignments',
        'user_skillsets'
    ];
begin
    foreach t in array tables loop
        if to_regclass('public.' || t) is not null then
            -- Row level security with no policies = deny everything for anon/authenticated.
            -- The service role used by the API bypasses RLS, so the app keeps working.
            execute format('alter table public.%I enable row level security', t);
            execute format('alter table public.%I force row level security', t);
            execute format('revoke all on table public.%I from anon, authenticated', t);
        end if;
    end loop;
end $$;

-- The old public views that the browser used to read. Nothing needs them any more.
do $$
begin
    if to_regclass('public.public_app_settings') is not null then
        execute 'revoke all on public.public_app_settings from anon, authenticated';
    end if;
    if to_regclass('public.public_games') is not null then
        execute 'revoke all on public.public_games from anon, authenticated';
    end if;
end $$;

-- New tables created later should not be public by default either.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- -------------------------------------------------------------------------------------
-- Check: every row below should say rls_enabled = true and anon_can_select = false.
-- -------------------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
order by anon_can_select desc, rls_enabled, table_name;
