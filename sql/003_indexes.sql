-- =====================================================================================
-- 003_indexes.sql
--
-- Indexes for the lookups the API does on every page load (sessions, a person's requests,
-- team membership, ...). Each one is skipped quietly if the table or column doesn't exist
-- in your schema, so the script is safe to run on any version of the database.
-- =====================================================================================

do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_sessions' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_hr_sessions_roblox_user_id on public.hr_sessions (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_sessions' and column_name = 'expires_at') then
        execute 'create index if not exists idx_hr_sessions_expires_at on public.hr_sessions (expires_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_payment_requests_roblox_user_id on public.payment_requests (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'status') then
        execute 'create index if not exists idx_payment_requests_status on public.payment_requests (status)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'run_id') then
        execute 'create index if not exists idx_payment_requests_run_id on public.payment_requests (run_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'created_at') then
        execute 'create index if not exists idx_payment_requests_created_at on public.payment_requests (created_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_requests' and column_name = 'requested_by_user_id') then
        execute 'create index if not exists idx_payment_requests_requested_by_user_id on public.payment_requests (requested_by_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_methods' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_payment_methods_roblox_user_id on public.payment_methods (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_assignments' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_user_assignments_roblox_user_id on public.user_assignments (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_assignments' and column_name = 'team_id') then
        execute 'create index if not exists idx_user_assignments_team_id on public.user_assignments (team_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_role_assignments' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_user_role_assignments_roblox_user_id on public.user_role_assignments (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_role_assignments' and column_name = 'role_id') then
        execute 'create index if not exists idx_user_role_assignments_role_id on public.user_role_assignments (role_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'user_skillsets' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_user_skillsets_roblox_user_id on public.user_skillsets (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_tasks' and column_name = 'team_id') then
        execute 'create index if not exists idx_team_tasks_team_id on public.team_tasks (team_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_tasks' and column_name = 'assigned_to_user_id') then
        execute 'create index if not exists idx_team_tasks_assigned_to_user_id on public.team_tasks (assigned_to_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_tasks' and column_name = 'status') then
        execute 'create index if not exists idx_team_tasks_status on public.team_tasks (status)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recruitment_tickets' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_recruitment_tickets_roblox_user_id on public.recruitment_tickets (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recruitment_tickets' and column_name = 'status') then
        execute 'create index if not exists idx_recruitment_tickets_status on public.recruitment_tickets (status)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'recruitment_tickets' and column_name = 'created_at') then
        execute 'create index if not exists idx_recruitment_tickets_created_at on public.recruitment_tickets (created_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff_warnings' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_staff_warnings_roblox_user_id on public.staff_warnings (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'banned_users' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_banned_users_roblox_user_id on public.banned_users (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_holds' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_security_holds_roblox_user_id on public.security_holds (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'discord_links' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_discord_links_roblox_user_id on public.discord_links (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'audit_logs' and column_name = 'created_at') then
        execute 'create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_events' and column_name = 'created_at') then
        execute 'create index if not exists idx_security_events_created_at on public.security_events (created_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'security_events' and column_name = 'kind') then
        execute 'create index if not exists idx_security_events_kind on public.security_events (kind)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff_onboarding_progress' and column_name = 'roblox_user_id') then
        execute 'create index if not exists idx_staff_onboarding_progress_roblox_user_id on public.staff_onboarding_progress (roblox_user_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'oauth_states' and column_name = 'created_at') then
        execute 'create index if not exists idx_oauth_states_created_at on public.oauth_states (created_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'discord_oauth_states' and column_name = 'created_at') then
        execute 'create index if not exists idx_discord_oauth_states_created_at on public.discord_oauth_states (created_at)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'game_stat_snapshots' and column_name = 'game_id') then
        execute 'create index if not exists idx_game_stat_snapshots_game_id on public.game_stat_snapshots (game_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'board_cards' and column_name = 'team_id') then
        execute 'create index if not exists idx_board_cards_team_id on public.board_cards (team_id)';
    end if;
end $$;
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'team_games' and column_name = 'team_id') then
        execute 'create index if not exists idx_team_games_team_id on public.team_games (team_id)';
    end if;
end $$;

-- Session tokens are looked up by value on every request. Usually already unique/primary.
do $$ begin
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'hr_sessions' and column_name = 'token') then
        execute 'create unique index if not exists idx_hr_sessions_token on public.hr_sessions (token)';
    end if;
exception when others then
    raise notice 'Skipped unique index on hr_sessions.token: %', sqlerrm;
end $$;

analyze;
