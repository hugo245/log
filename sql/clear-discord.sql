-- =========================================================================================
--  Studio Panel: clear every Discord id from the database
--
--  Discord is a paid add-on and is off unless ADDON_DISCORD=true. While it's off the API
--  already ignores all of these values, so running this is optional. Use it to wipe the
--  Discord ids an earlier version stored (role ids, server ids, channel ids) so nothing
--  Discord-related is left in the settings.
--
--  It does NOT delete anyone's payments, roles, teams or accounts.
--  If you later buy the Discord add-on you'll need to enter these ids again.
-- =========================================================================================

begin;

update public.app_settings set recruitment_discord_role_id = null where id = 1;

update public.roles set discord_role_id = null where discord_role_id is not null;
update public.recruitment_positions set discord_role_id = null where discord_role_id is not null;
update public.teams set discord_url = null where discord_url is not null;

delete from public.base_access_discord_servers;
delete from public.discord_oauth_states;

commit;
