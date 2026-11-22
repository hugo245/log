-- =========================================================================================
--  Studio Panel: upgrade an existing database to this version
--
--  Safe to run on a live database, and safe to run more than once. It never deletes data.
--  Run it in the Supabase SQL editor after updating the code, before restarting the API.
--
--  What it does:
--    1. Adds app_settings.branding (Settings > Branding saves here)
--    2. Gives the Owner and Admin roles the new "Edit branding" permission
--    3. Re-applies the database lock-down to any table it adds
-- =========================================================================================

begin;

-- 1. Branding column ---------------------------------------------------------------------
alter table public.app_settings
    add column if not exists branding jsonb not null default '{}'::jsonb;

-- 2. New permission for the starter Owner and Admin roles ------------------------------------
update public.roles
set permissions = permissions || '["settings.manage_branding"]'::jsonb
where name in ('Owner', 'Admin')
  and not permissions ? 'settings.manage_branding';

-- 3. Keep the database closed to the public key -----------------------------------------------
do $$
declare r record;
begin
    for r in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I enable row level security', r.tablename);
        execute format('revoke all on table public.%I from anon, authenticated', r.tablename);
    end loop;
end $$;

commit;

-- Check: should return one row with has_branding = true.
select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'app_settings' and column_name = 'branding'
) as has_branding;
