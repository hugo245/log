-- =========================================================================================
--  Studio Panel: delete ALL data, keep the tables
--
--  Empties every table (requests, payouts, people, sessions, settings, audit log...) and
--  puts back the default settings row and starter roles. Everyone is signed out.
--  Your branding (Settings > Branding: name, logo, colours, legal text) is kept.
--  Cannot be undone. Take a backup first if you might want anything back.
-- =========================================================================================

begin;

create temporary table keep_branding on commit drop as
    select branding from public.app_settings where id = 1;

do $$
declare r record;
begin
    for r in select tablename from pg_tables where schemaname = 'public' loop
        execute format('truncate table public.%I restart identity cascade', r.tablename);
    end loop;
end $$;

alter sequence if exists public.accounts_id_seq restart with 1000000000000000;

insert into public.app_settings (id, branding)
values (1, coalesce((select branding from keep_branding limit 1), '{}'::jsonb));

-- Starter roles. Assign them from Settings > Roles, or automatically:
--   OWNER_ROBLOX_IDS / OWNER_EMAILS in the API's environment get "Owner" on sign-in.
insert into public.roles (name, hierarchy, link_only, permissions) values
('Owner', 100, true, '["dashboard.view","dashboard.mark_paid","dashboard.export","dashboard.submit_request",
  "settings.manage_games","settings.manage_rate","settings.manage_groups","settings.manage_base_access",
  "settings.manage_onboarding","settings.manage_branding","roles.manage","staff.view_database","staff.moderate","broadcasts.manage",
  "audit.view","audit.revert","backups.manage","recruitment.view","recruitment.respond","recruitment.manage",
  "recruitment.signoff","recruitment.finalise","recruitment.analytics","payouts.view_bank_details",
  "security.manage","teams.view","teams.manage","revenue.manage","contracts.manage","tax.view"]'::jsonb),
('Admin', 90, true, '["dashboard.view","dashboard.mark_paid","dashboard.export","dashboard.submit_request",
  "settings.manage_games","settings.manage_rate","settings.manage_groups","settings.manage_base_access",
  "settings.manage_onboarding","settings.manage_branding","roles.manage","staff.view_database","staff.moderate","broadcasts.manage",
  "audit.view","backups.manage","recruitment.view","recruitment.manage","recruitment.signoff",
  "recruitment.finalise","recruitment.analytics","security.manage","teams.view","teams.manage","revenue.manage","contracts.manage"]'::jsonb),
('Manager', 50, true, '["dashboard.view","dashboard.mark_paid","dashboard.export","dashboard.submit_request",
  "staff.view_database","staff.moderate","teams.view","teams.manage","recruitment.view","audit.view","contracts.manage"]'::jsonb),
('Lead', 30, true, '["dashboard.view","dashboard.submit_request","staff.view_database","teams.view","teams.manage"]'::jsonb),
('Staff', 10, true, '["teams.view"]'::jsonb);

commit;
