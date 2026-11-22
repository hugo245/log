-- =====================================================================================
-- 002_branding.sql
--
-- Lets admins edit branding (name, logo, colours, sign-in page, features) from
-- Settings > Branding. Without this column the hub still works and uses
-- studio.config.json, but the Branding panel can't save.
-- =====================================================================================

alter table public.app_settings
    add column if not exists branding jsonb not null default '{}'::jsonb;

-- The API reads settings from row id = 1.
do $$ begin
    insert into public.app_settings (id) values (1) on conflict (id) do nothing;
exception when others then
    raise notice 'app_settings row 1 not created automatically (%). It probably exists already.', sqlerrm;
end $$;
