-- Khidki Upgrade Migration (Phase 3)
-- 1. Replaces preset sticker avatars with an optional raster-only DP (avatar_url)
-- 2. Changes post-seen auto-clean timer to 1 minute across all messages, media, and files
-- 3. Returns seen_by from mark_conversation_seen for instant DM and group unread clearing
-- 4. Overlaps poll_call_signals cursor by 5s so rapid ICE candidates never miss boundaries
-- 5. Upgrades delete_account() for genuine zero-to-whole cloud erasure while keeping logout safe

-- --------------------------------------------------------- DP validator ------

create or replace function public.is_valid_dp_url(p_url text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    p_url is null
    or (
      char_length(p_url) between 32 and 36000
      and p_url ~ '^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$'
    );
$$;

-- ---------------------------------------------------- profile DP column ------

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  drop constraint if exists profiles_avatar_url_check;

alter table public.profiles
  add constraint profiles_avatar_url_check
  check (public.is_valid_dp_url(avatar_url));

alter table public.profiles
  drop constraint if exists profiles_avatar_id_check;

alter table public.profiles
  drop column if exists avatar_id;

drop function if exists public.is_valid_avatar_id(text);

create or replace function public.prevent_username_change()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.username is distinct from old.username then
    raise exception 'Usernames cannot be changed.';
  end if;
  if new.canonical_email is distinct from old.canonical_email and old.canonical_email is not null then
    raise exception 'Canonical email cannot be changed.';
  end if;
  if old.public_key is not null and new.public_key is null then
    raise exception 'A device public key cannot be removed.';
  end if;
  if new.public_key is not null and not public.is_valid_public_key(new.public_key) then
    raise exception 'Invalid device public key.';
  end if;
  if not public.is_valid_dp_url(new.avatar_url) then
    raise exception 'Only valid compressed image DPs are allowed.';
  end if;
  return new;
end;
$$;

-- -------------------------------------------- signup & username helpers ------

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    lower(trim(p_username)) ~ '^[a-z0-9]{3,10}$'
    and lower(trim(p_username)) <> all (array[
      'admin', 'api', 'help', 'khidki', 'mail', 'mod', 'null',
      'official', 'root', 'security', 'sotto', 'support', 'system', 'team', 'www'
    ])
    and not exists (
      select 1
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.username = lower(trim(p_username))
        and (
          u.email_confirmed_at is not null
          or u.created_at > now() - interval '30 minutes'
        )
    );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uname text;
  dname text;
  dp text;
  pkey jsonb;
  kv jsonb;
  canon text;
begin
  uname := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  dname := trim(coalesce(new.raw_user_meta_data ->> 'display_name', uname));
  dp := nullif(trim(coalesce(new.raw_user_meta_data ->> 'avatar_url', '')), '');
  pkey := new.raw_user_meta_data -> 'public_key';
  kv := new.raw_user_meta_data -> 'key_vault';
  canon := public.canonicalize_email(new.email);

  if uname !~ '^[a-z0-9]{3,10}$' then
    raise exception 'Usernames must be 3 to 10 characters using only a-z and 0-9.';
  end if;

  if uname = any (array[
    'admin', 'api', 'help', 'khidki', 'mail', 'mod', 'null',
    'official', 'root', 'security', 'sotto', 'support', 'system', 'team', 'www'
  ]) then
    raise exception 'That username is reserved.';
  end if;

  if char_length(dname) < 1 or char_length(dname) > 36 then
    raise exception 'Display name must be between 1 and 36 characters.';
  end if;

  if not public.is_valid_dp_url(dp) then
    dp := null;
  end if;

  if not public.is_valid_public_key(pkey) then
    raise exception 'A valid device public key is required.';
  end if;

  -- Reclaim usernames held by abandoned unconfirmed signups older than 30 minutes
  delete from auth.users u
  using public.profiles p
  where p.id = u.id
    and p.username = uname
    and u.id <> new.id
    and u.email_confirmed_at is null
    and u.created_at <= now() - interval '30 minutes';

  insert into public.profiles (id, username, display_name, avatar_url, public_key, canonical_email)
  values (new.id, uname, dname, dp, pkey, canon);

  if kv is not null and jsonb_typeof(kv) = 'object' and public.is_valid_key_vault(kv) then
    insert into public.profile_vaults (user_id, key_vault)
    values (new.id, kv)
    on conflict (user_id) do update set key_vault = excluded.key_vault, updated_at = now();
  end if;

  return new;
end;
$$;

-- -------------------------------------------------------- people search ------

drop function if exists public.search_people(text);

create or replace function public.search_people(p_query text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  public_key jsonb
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  clean_query text := regexp_replace(lower(trim(coalesce(p_query, ''))), '^@', '');
begin
  perform public.enforce_rate_limit('search_people', 60, 60);

  if char_length(clean_query) < 2 or char_length(clean_query) > 10 then
    return;
  end if;

  if clean_query !~ '^[a-z0-9]+$' then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.avatar_url, p.public_key
    from public.profiles p
    join auth.users u on u.id = p.id
    where auth.uid() is not null
      and p.id <> auth.uid()
      and p.public_key is not null
      and u.email_confirmed_at is not null
      and starts_with(p.username, clean_query)
    order by
      (p.username = clean_query) desc,
      p.username asc
    limit 12;
end;
$$;

-- ------------------------------- 1-minute post-seen timer across all items ---

drop function if exists public.mark_conversation_seen(uuid);

create or replace function public.mark_conversation_seen(p_conversation_id uuid)
returns table (
  id uuid,
  seen_at timestamptz,
  expires_at timestamptz,
  seen_by uuid[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conv_kind text;
  other_member_count int;
  stamp timestamptz := now();
  exp timestamptz := stamp + interval '1 minute';
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'You are not a member of this conversation.';
  end if;

  perform public.purge_expired_messages();

  select kind into conv_kind
  from public.conversations
  where public.conversations.id = p_conversation_id;

  if conv_kind = 'dm' then
    return query
      update public.messages m
      set seen_by = case when me = any (m.seen_by) then m.seen_by else array_append(m.seen_by, me) end,
          seen_at = coalesce(m.seen_at, stamp),
          expires_at = coalesce(m.expires_at, exp)
      where m.conversation_id = p_conversation_id
        and m.sender_id <> me
        and m.seen_at is null
      returning m.id, m.seen_at, m.expires_at, m.seen_by;
  else
    select greatest(count(*) - 1, 1) into other_member_count
    from public.conversation_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.conversation_id = p_conversation_id
      and p.public_key is not null;

    return query
      with marked as (
        update public.messages m
        set seen_by = case when me = any (m.seen_by) then m.seen_by else array_append(m.seen_by, me) end,
            seen_at = case
              when m.seen_at is not null then m.seen_at
              when coalesce(array_length(case when me = any (m.seen_by) then m.seen_by else array_append(m.seen_by, me) end, 1), 0) >= other_member_count then stamp
              else null
            end,
            expires_at = case
              when m.expires_at is not null then m.expires_at
              when coalesce(array_length(case when me = any (m.seen_by) then m.seen_by else array_append(m.seen_by, me) end, 1), 0) >= other_member_count then exp
              else null
            end
        where m.conversation_id = p_conversation_id
          and m.sender_id <> me
          and (m.seen_at is null or not (me = any (m.seen_by)))
        returning m.id, m.seen_at, m.expires_at, m.seen_by
      )
      select marked.id, marked.seen_at, marked.expires_at, marked.seen_by from marked;
  end if;
end;
$$;

-- ------------------------------- overlapped call signal polling --------------

create or replace function public.poll_call_signals(p_since timestamptz default null)
returns setof public.call_signals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return; end if;

  delete from public.call_signals
  where created_at <= now() - interval '60 seconds';

  return query
    select *
    from public.call_signals s
    where s.recipient_id = me
      and (p_since is null or s.created_at >= p_since - interval '5 seconds')
    order by s.created_at asc
    limit 80;
end;
$$;

-- ------------------------------- zero-to-whole account deletion --------------

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  grp record;
  next_admin uuid;
begin
  if me is null then
    raise exception 'Not authenticated.';
  end if;

  -- 1. Erase all ephemeral call signals involving this user
  delete from public.call_signals
  where sender_id = me or recipient_id = me;

  -- 2. Erase all messages sent by this user across every conversation
  delete from public.messages
  where sender_id = me;

  -- 3. Erase all 1-on-1 direct message conversations involving this user
  --    (cascades to queued messages, wrapped keys, and memberships)
  delete from public.conversations c
  where c.kind = 'dm'
    and exists (
      select 1
      from public.conversation_members cm
      where cm.conversation_id = c.id
        and cm.user_id = me
    );

  -- 4. Clean up group memberships, wrapped keys, and orphaned/adminless groups
  delete from public.conversation_keys
  where user_id = me or from_user = me;

  for grp in
    select cm.conversation_id, cm.role
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
    where cm.user_id = me
      and c.kind = 'group'
  loop
    delete from public.conversation_members
    where conversation_id = grp.conversation_id
      and user_id = me;

    if (
      select count(*)
      from public.conversation_members
      where conversation_id = grp.conversation_id
    ) < 2 then
      delete from public.conversations
      where id = grp.conversation_id;
    elsif grp.role = 'admin' and not exists (
      select 1
      from public.conversation_members
      where conversation_id = grp.conversation_id
        and role = 'admin'
    ) then
      select user_id into next_admin
      from public.conversation_members
      where conversation_id = grp.conversation_id
      order by joined_at asc
      limit 1;

      if next_admin is not null then
        update public.conversation_members
        set role = 'admin'
        where conversation_id = grp.conversation_id
          and user_id = next_admin;
      end if;
    end if;
  end loop;

  update public.conversations
  set created_by = null
  where created_by = me;

  update public.conversations
  set requested_by = null
  where requested_by = me;

  -- 5. Erase rate-limit counters and encrypted key vault
  delete from public.rate_limits
  where user_id = me;

  delete from public.profile_vaults
  where user_id = me;

  -- 6. Erase public profile (username, display name, DP, public key, canonical email)
  delete from public.profiles
  where id = me;

  -- 7. Erase auth.users record (cascades sessions, refresh tokens, identities, OTPs)
  delete from auth.users
  where id = me;
end;
$$;

-- ------------------------------------------------------- grants --------------

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url, public_key) on public.profiles to authenticated;

revoke all on function public.is_valid_dp_url(text) from public;
grant execute on function public.is_valid_dp_url(text) to anon, authenticated;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

revoke all on function public.search_people(text) from public, anon;
revoke all on function public.mark_conversation_seen(uuid) from public, anon;
revoke all on function public.poll_call_signals(timestamptz) from public, anon;
revoke all on function public.delete_account() from public, anon;

grant execute on function public.search_people(text) to authenticated;
grant execute on function public.mark_conversation_seen(uuid) to authenticated;
grant execute on function public.poll_call_signals(timestamptz) to authenticated;
grant execute on function public.delete_account() to authenticated;
