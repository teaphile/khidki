-- Security hardening and request-retention clarity.
-- 1. Keep canonical signup email private from authenticated profile reads.
-- 2. Give the client only the profile columns required by the app.
-- 3. Document that pending requests have no time-based expiry.

revoke all privileges on table public.profiles from public, anon, authenticated;
revoke select (canonical_email) on table public.profiles from public, anon, authenticated;

grant select (id, username, display_name, avatar_url, public_key, created_at)
  on table public.profiles to authenticated;

grant update (display_name, avatar_url, public_key)
  on table public.profiles to authenticated;

comment on column public.profiles.canonical_email is
  'Private normalized signup email; not selectable by anon or authenticated clients.';

comment on column public.conversations.request_status is
  'Pending direct-message requests have no time-based expiry and remain pending until accepted or removed.';

