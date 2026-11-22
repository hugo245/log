-- =========================================================================================
--  Studio Panel: complete database setup
--
--  Run this once in the Supabase SQL editor (Database > SQL editor > New query > Run).
--
--  WARNING: this DROPS every Studio Panel table and recreates it empty. All data is lost.
--  Use it for a fresh install, or to start over. To keep the tables but delete the data,
--  use reset-data.sql instead.
--
--  What it does:
--    1. Drops the old tables, views and sequences
--    2. Creates every table the API uses, with sensible defaults and constraints
--    3. Adds indexes for the lookups that run on every page load
--    4. Locks the database: row level security on, no access for the public anon key.
--       Only the API (service role key) can read or write.
--    5. Seeds the settings row and a starter set of roles (Owner, Admin, Manager, Lead, Staff)
--
--  Safe to re-run. Takes a few seconds.
-- =========================================================================================

begin;

-- -----------------------------------------------------------------------------------------
-- 1. Clean slate
-- -----------------------------------------------------------------------------------------
drop view if exists public.public_app_settings cascade;
drop view if exists public.public_games cascade;

do $$
declare t text;
begin
    foreach t in array array[
        'accounts', 'app_settings', 'audit_logs', 'backups', 'banned_users', 'base_access_discord_servers',
        'base_access_groups', 'board_cards', 'board_lists', 'broadcasts', 'discord_links', 'discord_oauth_states',
        'game_stat_snapshots', 'games', 'group_eligibility_cache', 'hr_sessions', 'oauth_states',
        'onboarding_links', 'payment_methods', 'payment_requests', 'payment_runs', 'rate_bands',
        'recruit_onboarding_flows', 'recruit_push_subscriptions', 'recruit_sessions', 'recruitment_messages',
        'recruitment_positions', 'recruitment_tickets', 'required_groups', 'roles', 'security_events',
        'security_holds', 'skillsets', 'staff_onboarding_progress', 'staff_warnings', 'team_games',
        'team_skillsets', 'team_tasks', 'teams', 'user_assignments', 'user_flags', 'user_role_assignments',
        'user_skillsets'
    ] loop
        execute format('drop table if exists public.%I cascade', t);
    end loop;
end $$;

drop sequence if exists public.accounts_id_seq;

-- -----------------------------------------------------------------------------------------
-- 2. Tables
--    User ids: Roblox user ids for Roblox sign-ins. People who sign in with Google or test
--    mode get an id from accounts_id_seq, which starts far above any Roblox id, so the two
--    can never collide. Every *_user_id column below holds one of these.
-- -----------------------------------------------------------------------------------------

-- Settings (exactly one row, id = 1) ------------------------------------------------------
create table public.app_settings (
    id                                integer primary key default 1 check (id = 1),
    devex_rate                        numeric default 0.0035,
    usd_minimum_pending               numeric default 0,
    ignore_eligibility                boolean not null default false,
    onboarding_group_id               bigint,
    onboarding_group_role_id          bigint,
    recruitment_auto_role_id          text,
    recruitment_discord_role_id       text,
    recruitment_grace_period_hours    numeric,
    recruitment_notify_role_id        text,
    recruitment_signoff_role_id       text,
    recruitment_producer_role_id      text,
    security_level                    text not null default 'normal' check (security_level in ('normal', 'heightened', 'lockdown')),
    security_note                     text,
    security_set_by                   text,
    security_set_at                   timestamptz,
    security_auto_raise               boolean not null default true,
    security_method_window_minutes    integer not null default 60,
    security_method_threshold         integer not null default 3,
    -- Site status. Flip these in the table editor to show the status screens.
    closed                            boolean not null default false,
    indev                             boolean not null default false,
    services_down                     boolean not null default false,
    status_message                    text,
    status_started_at                 timestamptz,
    status_eta                        timestamptz,
    status_timeline                   jsonb not null default '[]'::jsonb,
    services                          jsonb not null default '[]'::jsonb,
    -- Branding edited in Settings > Branding (name, logo, colours, sign-in page, legal text).
    -- Layered over studio.config.json. Empty = use the file.
    branding                          jsonb not null default '{}'::jsonb,
    updated_at                        timestamptz not null default now()
);

-- Accounts for non-Roblox sign-ins (Google, test mode) ------------------------------------
create sequence public.accounts_id_seq start with 1000000000000000 minvalue 1000000000000000;
create table public.accounts (
    id                 bigint primary key default nextval('public.accounts_id_seq'),
    provider           text not null check (provider in ('google', 'test')),
    provider_user_id   text not null,
    email              text,
    display_name       text not null,
    avatar_url         text,
    created_at         timestamptz not null default now(),
    last_login_at      timestamptz,
    unique (provider, provider_user_id)
);
alter sequence public.accounts_id_seq owned by public.accounts.id;

-- Sign-in ---------------------------------------------------------------------------------
create table public.hr_sessions (
    token              text primary key,            -- SHA-256 hash of the browser's token
    roblox_user_id     bigint not null,
    roblox_username    text,
    provider           text not null default 'roblox',
    roles              jsonb not null default '[]'::jsonb,
    permissions        jsonb not null default '[]'::jsonb,
    max_hierarchy      integer not null default 0,
    user_agent         text,
    created_at         timestamptz not null default now(),
    last_seen_at       timestamptz,
    last_synced_at     timestamptz,
    expires_at         timestamptz not null
);

create table public.oauth_states (
    state              text primary key,
    code_verifier      text,
    ref_token          text,
    provider           text not null default 'roblox',
    nonce              text,
    created_at         timestamptz not null default now()
);

create table public.discord_oauth_states (
    state              text primary key,
    rt                 text,
    is_staff           boolean not null default false,
    return_hash        text,
    created_at         timestamptz not null default now()
);

create table public.recruit_sessions (
    token              text primary key,
    roblox_user_id     bigint not null,
    roblox_username    text,
    discord_user_id    text,
    discord_username   text,
    discord_avatar     text,
    expires_at         timestamptz,
    created_at         timestamptz not null default now()
);

create table public.discord_links (
    roblox_user_id     bigint primary key,
    roblox_username    text,
    discord_user_id    text not null unique,
    discord_username   text,
    discord_avatar     text,
    linked_at          timestamptz not null default now()
);

create table public.user_flags (
    roblox_user_id     bigint primary key,
    roblox_username    text,
    tour_version       integer,
    tour_seen_at       timestamptz,
    updated_at         timestamptz not null default now()
);

-- Access ----------------------------------------------------------------------------------
create table public.roles (
    id                 bigint generated by default as identity primary key,
    name               text not null,
    roblox_group_id    bigint,
    min_rank           integer,
    hierarchy          integer not null default 0,
    permissions        jsonb not null default '[]'::jsonb,
    link_only          boolean not null default false,
    discord_role_id    text,
    created_at         timestamptz not null default now()
);

create table public.user_role_assignments (
    id                 bigint generated by default as identity primary key,
    roblox_user_id     bigint not null,
    roblox_username    text,
    role_id            bigint not null,
    created_at         timestamptz not null default now(),
    unique (roblox_user_id, role_id)
);

create table public.base_access_groups (
    id                 bigint generated by default as identity primary key,
    roblox_group_id    bigint not null,
    min_rank           integer,
    name               text,
    created_at         timestamptz not null default now()
);

create table public.base_access_discord_servers (
    id                 bigint generated by default as identity primary key,
    discord_guild_id   text not null unique,
    name               text,
    created_at         timestamptz not null default now()
);

create table public.required_groups (
    id                 bigint generated by default as identity primary key,
    roblox_group_id    bigint not null unique,
    name               text,
    min_rank           integer,
    created_at         timestamptz not null default now()
);

create table public.group_eligibility_cache (
    roblox_user_id     bigint not null,
    required_group_id  bigint not null,
    is_member          boolean not null default false,
    eligible           boolean not null default false,
    checked_at         timestamptz not null default now(),
    primary key (roblox_user_id, required_group_id)
);

-- Teams, skills, games ----------------------------------------------------------------------
create table public.teams (
    id                    bigint generated by default as identity primary key,
    name                  text not null unique,
    color                 text,
    info                  text,
    discord_url           text,
    roblox_group_id       bigint,
    roblox_group_url      text,
    default_group_role_id bigint,
    created_at            timestamptz not null default now()
);

create table public.skillsets (
    id                 bigint generated by default as identity primary key,
    name               text not null unique,
    color              text,
    description        text,
    created_at         timestamptz not null default now()
);

create table public.team_skillsets (
    team_id            bigint not null,
    skillset_id        bigint not null,
    primary key (team_id, skillset_id)
);

create table public.user_assignments (
    id                 bigint generated by default as identity primary key,
    roblox_user_id     bigint not null,
    roblox_username    text,
    team_id            bigint,
    skillset_id        bigint,
    source_link_token  text,
    assigned_at        timestamptz not null default now(),
    unique (roblox_user_id, team_id)
);

create table public.user_skillsets (
    id                 bigint generated by default as identity primary key,
    roblox_user_id     bigint not null,
    roblox_username    text,
    skillset_id        bigint not null,
    created_at         timestamptz not null default now(),
    unique (roblox_user_id, skillset_id)
);

create table public.games (
    id                  bigint generated by default as identity primary key,
    name                text not null unique,
    producer_user_id    bigint,
    producer_username   text,
    roblox_place_id     bigint,
    roblox_universe_id  bigint,
    icon_url            text,
    thumbnail_url       text,
    budget_amount       numeric,
    budget_currency     text default 'USD',
    created_at          timestamptz not null default now()
);

create table public.team_games (
    team_id            bigint not null,
    game_id            bigint not null,
    due_at             timestamptz,
    created_at         timestamptz not null default now(),
    primary key (team_id, game_id)
);

create table public.game_stat_snapshots (
    id                 bigint generated by default as identity primary key,
    game_id            bigint not null,
    universe_id        bigint,
    captured_at        timestamptz not null default now(),
    playing            bigint,
    visits             bigint,
    favorites          bigint,
    likes              bigint,
    dislikes           bigint
);

create table public.team_tasks (
    id                   bigint generated by default as identity primary key,
    batch_id             text,
    team_id              bigint not null,
    game_id              bigint,
    title                text not null,
    details              text,
    payment              numeric,
    currency             text,
    due_at               timestamptz,
    repeat_every         text check (repeat_every in ('weekly', 'fortnightly', 'monthly')),
    status               text not null default 'open',
    assigned_to_user_id  bigint,
    assigned_to_username text,
    reminders_sent       jsonb not null default '[]'::jsonb,
    created_by           text,
    created_at           timestamptz not null default now(),
    submitted_at         timestamptz,
    submitted_by         text,
    completed_at         timestamptz,
    completed_by         text,
    approved_at          timestamptz,
    approved_by          text,
    review_note          text,
    payment_request_id   text,
    rate_band_id         bigint
);

create table public.board_lists (
    id                 bigint generated by default as identity primary key,
    team_id            bigint not null,
    title              text not null,
    position           numeric not null default 0,
    is_default         boolean not null default false,
    archived           boolean not null default false,
    created_by         text,
    created_at         timestamptz not null default now()
);

create table public.board_cards (
    id                   bigint generated by default as identity primary key,
    team_id              bigint not null,
    list_id              bigint not null,
    title                text not null,
    description          text,
    label                text,
    assigned_to_user_id  bigint,
    assigned_to_username text,
    due_at               timestamptz,
    position             numeric not null default 0,
    archived             boolean not null default false,
    created_by           text,
    created_at           timestamptz not null default now()
);

create table public.broadcasts (
    id                 bigint generated by default as identity primary key,
    type               text not null default 'global' check (type in ('global', 'team')),
    team_id            bigint references public.teams (id) on delete cascade,
    message            text not null,
    created_by         text,
    created_at         timestamptz not null default now()
);

-- Money ---------------------------------------------------------------------------------------
create table public.payment_runs (
    id                 bigint generated by default as identity primary key,
    label              text,
    period_start       timestamptz,
    period_end         timestamptz,
    pay_date           timestamptz,
    status             text not null default 'open',
    created_by         text,
    created_at         timestamptz not null default now(),
    frozen_at          timestamptz,
    frozen_by          text,
    closed_at          timestamptz,
    closed_by          text
);

create table public.payment_requests (
    id                    text primary key,
    requested_by          text,
    requested_by_user_id  bigint,
    roblox_username       text,
    roblox_user_id        bigint,
    task_name             text not null,
    game                  text,
    game_id               bigint,
    work_raw              text,
    time_worked           text,
    payment               numeric not null check (payment >= 0),
    currency              text not null default 'ROBUX',
    currency_locked       boolean not null default false,
    payment_method        text,
    skillset_id           bigint,
    skillset_name         text,
    skillset_ids          jsonb,
    skillset_names        jsonb,
    paid                  boolean not null default false,
    paid_at               timestamptz,
    status                text not null default 'pending',
    status_note           text,
    run_id                bigint,
    created_at            timestamptz not null default now()
);

create table public.payment_methods (
    roblox_user_id     bigint primary key,
    roblox_username    text,
    method             text not null,
    details            jsonb not null default '{}'::jsonb,
    set_by             text,
    updated_at         timestamptz not null default now()
);

create table public.rate_bands (
    id                 bigint generated by default as identity primary key,
    name               text not null,
    amount             numeric not null,
    currency           text not null default 'USD',
    notes              text,
    skillset_id        bigint,
    active             boolean not null default true,
    created_by         text,
    created_at         timestamptz not null default now()
);

-- People ------------------------------------------------------------------------------------
create table public.staff_warnings (
    id                 bigint generated by default as identity primary key,
    roblox_user_id     bigint not null,
    roblox_username    text,
    reason             text,
    warned_by          text,
    issued_by          text,
    issued_by_user_id  bigint,
    created_at         timestamptz not null default now()
);

create table public.banned_users (
    roblox_user_id     bigint primary key,
    roblox_username    text,
    reason             text,
    banned_by          text,
    banned_at          timestamptz not null default now(),
    expires_at         timestamptz
);

create table public.security_holds (
    roblox_user_id     bigint primary key,
    roblox_username    text,
    reason             text,
    placed_by          text,
    placed_by_user_id  bigint,
    placed_at          timestamptz not null default now()
);

create table public.staff_onboarding_progress (
    roblox_user_id     bigint not null,
    step_id            text not null,
    roblox_username    text,
    completed_at       timestamptz,
    primary key (roblox_user_id, step_id)
);

create table public.onboarding_links (
    token                  text primary key,
    label                  text,
    team_id                bigint,
    skillset_id            bigint,
    role_id                bigint,
    target_roblox_user_id  bigint,
    target_roblox_username text,
    uses                   integer not null default 0,
    created_by             text,
    created_at             timestamptz not null default now()
);

-- Recruitment -------------------------------------------------------------------------------
create table public.recruitment_positions (
    id                 bigint generated by default as identity primary key,
    name               text not null unique,
    discord_role_id    text,
    created_at         timestamptz not null default now()
);

create table public.recruitment_tickets (
    id                          bigint generated by default as identity primary key,
    roblox_user_id              bigint not null,
    roblox_username             text,
    discord_user_id             text,
    discord_username            text,
    position                    text,
    position_id                 bigint,
    experience                  text,
    why_join                    text,
    portfolio_url               text,
    referred_by_user_id         bigint,
    referred_by_username        text,
    status                      text not null default 'pending',
    assigned_to_user_id         bigint,
    assigned_to_username        text,
    discord_channel_id          text,
    ticket_message_id           text,
    team_selection_message_id   text,
    skillset_id                 bigint,
    skillset_name               text,
    next_phase_at               timestamptz,
    next_phase_by_username      text,
    placed_team_id              bigint,
    placed_team_name            text,
    placed_at                   timestamptz,
    signed_off_at               timestamptz,
    signed_off_by_username      text,
    finalised_at                timestamptz,
    first_response_at           timestamptz,
    first_response_by_username  text,
    closed_at                   timestamptz,
    closed_by_username          text,
    closed_by_roblox_user_id    bigint,
    closed_by_roblox_username   text,
    close_reason                text,
    auto_accepted               boolean not null default false,
    hire_role_granted           boolean not null default false,
    referral_reward_logged      boolean not null default false,
    reviewer_reward_logged      boolean not null default false,
    channel_delete_at           timestamptz,
    channel_deleted             boolean not null default false,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now()
);

create table public.recruitment_messages (
    id                 bigint generated by default as identity primary key,
    ticket_id          bigint,
    author_user_id     bigint,
    author_username    text,
    message            text,
    created_at         timestamptz not null default now()
);

create table public.recruit_onboarding_flows (
    id                 bigint generated by default as identity primary key,
    ticket_id          bigint,
    link_token         text,
    roblox_user_id     bigint not null,
    roblox_username    text,
    discord_user_id    text,
    dm_channel_id      text,
    message_id         text,
    step               text,
    last_prompt_state  text,
    team_id            bigint,
    skillset_id        bigint,
    role_id            bigint,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create table public.recruit_push_subscriptions (
    id                 bigint generated by default as identity primary key,
    roblox_user_id     bigint not null,
    endpoint           text not null unique,
    p256dh             text,
    auth               text,
    created_at         timestamptz not null default now()
);

-- Records -----------------------------------------------------------------------------------
create table public.audit_logs (
    id                 bigint generated by default as identity primary key,
    category           text,
    action             text,
    actor_user_id      bigint,
    actor_username     text,
    target_user_id     bigint,
    target_username    text,
    details            jsonb not null default '{}'::jsonb,
    revert_data        jsonb,
    reverted           boolean not null default false,
    reverted_at        timestamptz,
    reverted_by        text,
    created_at         timestamptz not null default now()
);

create table public.security_events (
    id                 bigint generated by default as identity primary key,
    kind               text not null,
    severity           text not null default 'info',
    actor_user_id      bigint,
    actor_username     text,
    target_user_id     bigint,
    target_username    text,
    detail             text,
    context            jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now()
);

create table public.backups (
    id                 bigint generated by default as identity primary key,
    created_by         text,
    "trigger"          text,
    tables             jsonb,
    row_counts         jsonb,
    size_bytes         bigint,
    data_gz            text,
    created_at         timestamptz not null default now()
);

-- -----------------------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------------------
create index on public.hr_sessions (roblox_user_id);
create index on public.hr_sessions (expires_at);
create index on public.oauth_states (created_at);
create index on public.discord_oauth_states (created_at);
create index on public.user_role_assignments (role_id);
create index on public.user_assignments (team_id);
create index on public.user_skillsets (skillset_id);
create index on public.team_tasks (team_id);
create index on public.team_tasks (assigned_to_user_id);
create index on public.team_tasks (status);
create index on public.team_tasks (batch_id);
create index on public.team_tasks (due_at) where due_at is not null;
create index on public.board_cards (list_id);
create index on public.board_cards (team_id);
create index on public.board_lists (team_id);
create index on public.game_stat_snapshots (game_id, captured_at desc);
create index on public.payment_requests (roblox_user_id);
create index on public.payment_requests (status);
create index on public.payment_requests (run_id) where run_id is not null;
create index on public.payment_requests (created_at desc);
create index on public.payment_requests (requested_by_user_id);
create index on public.staff_warnings (roblox_user_id);
create index on public.recruitment_tickets (roblox_user_id);
create index on public.recruitment_tickets (status);
create index on public.recruitment_tickets (created_at desc);
create index on public.recruit_onboarding_flows (roblox_user_id);
create index on public.recruit_onboarding_flows (link_token) where link_token is not null;
create index on public.audit_logs (created_at desc);
create index on public.security_events (created_at desc);
create index on public.security_events (kind, created_at desc);
create index on public.broadcasts (team_id);
create index on public.accounts (lower(email));

-- -----------------------------------------------------------------------------------------
-- 4. Lock it down
--    RLS on with no policies = nobody but the service role (the API) gets in.
-- -----------------------------------------------------------------------------------------
do $$
declare r record;
begin
    for r in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I enable row level security', r.tablename);
        execute format('alter table public.%I force row level security', r.tablename);
        execute format('revoke all on table public.%I from anon, authenticated', r.tablename);
    end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- The API needs full access (service_role bypasses RLS but still needs grants).
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- After a backup restore the API calls this so new rows don't collide with restored ids.
create or replace function public.studio_sync_sequences() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
    for r in
        select c.table_name, c.column_name
        from information_schema.columns c
        where c.table_schema = 'public' and c.is_identity = 'YES'
    loop
        execute format(
            'select setval(pg_get_serial_sequence(%L, %L), coalesce((select max(%I) from public.%I), 0) + 1, false)',
            'public.' || r.table_name, r.column_name, r.column_name, r.table_name);
    end loop;
end $$;
revoke all on function public.studio_sync_sequences() from public, anon, authenticated;
grant execute on function public.studio_sync_sequences() to service_role;

-- -----------------------------------------------------------------------------------------
-- 5. Seed data
-- -----------------------------------------------------------------------------------------
insert into public.app_settings (id) values (1);

-- Starter roles. Assign them from Settings > Roles, or automatically:
--   OWNER_ROBLOX_IDS / OWNER_EMAILS in the API's environment get "Owner" on sign-in.
insert into public.roles (name, hierarchy, link_only, permissions) values
('Owner', 100, true, '["dashboard.view","dashboard.mark_paid","dashboard.export","dashboard.submit_request",
  "settings.manage_games","settings.manage_rate","settings.manage_groups","settings.manage_base_access",
  "settings.manage_onboarding","settings.manage_branding","roles.manage","staff.view_database","staff.moderate","broadcasts.manage",
  "audit.view","audit.revert","backups.manage","recruitment.view","recruitment.respond","recruitment.manage",
  "recruitment.signoff","recruitment.finalise","recruitment.analytics","payouts.view_bank_details",
  "security.manage","teams.view","teams.manage"]'::jsonb),
('Admin', 90, true, '["dashboard.view","dashboard.mark_paid","dashboard.export","dashboard.submit_request",
  "settings.manage_games","settings.manage_rate","settings.manage_groups","settings.manage_base_access",
  "settings.manage_onboarding","settings.manage_branding","roles.manage","staff.view_database","staff.moderate","broadcasts.manage",
  "audit.view","backups.manage","recruitment.view","recruitment.manage","recruitment.signoff",
  "recruitment.finalise","recruitment.analytics","security.manage","teams.view","teams.manage"]'::jsonb),
('Manager', 50, true, '["dashboard.view","dashboard.mark_paid","dashboard.export","dashboard.submit_request",
  "staff.view_database","staff.moderate","teams.view","teams.manage","recruitment.view","audit.view"]'::jsonb),
('Lead', 30, true, '["dashboard.view","dashboard.submit_request","staff.view_database","teams.view","teams.manage"]'::jsonb),
('Staff', 10, true, '["teams.view"]'::jsonb);

commit;

-- -----------------------------------------------------------------------------------------
-- Check: every table should show rls_enabled = true and anon_can_select = false.
-- -----------------------------------------------------------------------------------------
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       has_table_privilege('anon', c.oid, 'select') as anon_can_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by anon_can_select desc, table_name;
