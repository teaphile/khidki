-- Sotto schema, policies, rate limits, and realtime authorization.
-- Apply this file once in the Supabase SQL editor, or with `supabase db push`.
--
-- What is stored here:
--   * profiles (username, display name, validated public keys)
--   * conversation metadata and memberships
--   * per-member wrapped conversation keys
--   * a disposable-email blocklist and per-user RPC rate-limit counters
--
-- What is never stored here:
--   * message bodies, captions, or attachments
--   * private keys (they live only in the browser's IndexedDB)
--
-- All client access goes through RLS or SECURITY DEFINER RPCs. The anon key
-- can only read public discovery functions and call the auth endpoints.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------- key validator ----

create or replace function public.is_valid_public_key(pkey jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    pkey is not null
    and jsonb_typeof(pkey) = 'object'
    and octet_length(pkey::text) <= 2048
    and pkey -> 'v' = '1'::jsonb
    and jsonb_typeof(pkey -> 'ecdh') = 'object'
    and jsonb_typeof(pkey -> 'sig') = 'object'
    and not ((pkey -> 'ecdh') ? 'd')
    and not ((pkey -> 'sig') ? 'd')
    and (pkey -> 'ecdh' ->> 'kty') = 'EC'
    and (pkey -> 'ecdh' ->> 'crv') = 'P-256'
    and (pkey -> 'ecdh' ->> 'x') ~ '^[A-Za-z0-9_-]{40,64}$'
    and (pkey -> 'ecdh' ->> 'y') ~ '^[A-Za-z0-9_-]{40,64}$'
    and (pkey -> 'sig' ->> 'kty') = 'EC'
    and (pkey -> 'sig' ->> 'crv') = 'P-256'
    and (pkey -> 'sig' ->> 'x') ~ '^[A-Za-z0-9_-]{40,64}$'
    and (pkey -> 'sig' ->> 'y') ~ '^[A-Za-z0-9_-]{40,64}$';
$$;

-- ---------------------------------------------------------------- tables ----

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 48),
  public_key jsonb
    check (public_key is null or public.is_valid_public_key(public_key)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'group')),
  title text,
  dm_key text unique,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversation_shape check (
    (kind = 'dm' and title is null and dm_key is not null)
    or
    (kind = 'group' and title is not null
      and char_length(title) between 1 and 64 and dm_key is null)
  )
);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id);

create table if not exists public.conversation_keys (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  wrapped_key text not null check (char_length(wrapped_key) between 16 and 4096),
  wrap_iv text not null check (char_length(wrap_iv) between 8 and 128),
  from_user uuid not null references public.profiles (id) on delete cascade,
  from_public_key jsonb not null
    check (public.is_valid_public_key(from_public_key)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- Compatibility for databases created before sender keys were recorded.
alter table public.conversation_keys
  add column if not exists from_public_key jsonb;

update public.conversation_keys k
set from_public_key = p.public_key
from public.profiles p
where k.from_public_key is null
  and p.id = k.from_user
  and p.public_key is not null;

delete from public.conversation_keys
where from_public_key is null
   or not public.is_valid_public_key(from_public_key);

alter table public.conversation_keys
  alter column from_public_key set not null;

create table if not exists public.blocked_email_domains (
  domain text primary key,
  reason text not null default 'disposable'
);

insert into public.blocked_email_domains (domain) values
  ('10minutemail.com'), ('burnermail.io'), ('crazymailing.com'),
  ('discard.email'), ('dispostable.com'), ('emailfake.com'),
  ('emailondeck.com'), ('fakeinbox.com'), ('getnada.com'), ('grr.la'),
  ('guerrillamail.com'), ('guerrillamail.de'), ('guerrillamail.info'),
  ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamailblock.com'),
  ('harakirimail.com'), ('inboxkitten.com'), ('mailcatch.com'),
  ('maildrop.cc'), ('mailinator.com'), ('mailnesia.com'), ('mailnull.com'),
  ('mailpoof.com'), ('mailsac.com'), ('mintemail.com'), ('mohmal.com'),
  ('mytemp.email'), ('pokemail.net'), ('sharklasers.com'), ('spam4.me'),
  ('spambox.us'), ('spamgourmet.com'), ('temp-mail.org'), ('tempail.com'),
  ('tempinbox.com'), ('tempmail.com'), ('tempmailo.com'), ('throwawaymail.com'),
  ('tmpmail.net'), ('tmpmail.org'), ('trashmail.com'), ('trashmail.net'),
  ('yopmail.com')
on conflict (domain) do nothing;

create table if not exists public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null check (char_length(action) between 1 and 64),
  hits int not null default 1 check (hits >= 1),
  reset_at timestamptz not null,
  primary key (user_id, action)
);

-- ------------------------------------------------------------- utilities ----

create or replace function public.enforce_rate_limit(
  p_action text,
  p_limit int,
  p_window_seconds int
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  current_hits int;
begin
  if me is null then
    raise exception 'Not authenticated.';
  end if;

  insert into public.rate_limits (user_id, action, hits, reset_at)
  values (me, p_action, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (user_id, action) do update
    set hits = case
          when public.rate_limits.reset_at <= now() then 1
          else public.rate_limits.hits + 1
        end,
        reset_at = case
          when public.rate_limits.reset_at <= now()
            then now() + make_interval(secs => p_window_seconds)
          else public.rate_limits.reset_at
        end
  returning hits into current_hits;

  if current_hits > p_limit then
    raise exception 'Too many requests. Wait a moment before trying again.';
  end if;
end;
$$;

create or replace function public.is_confirmed_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = p_user_id
      and u.email_confirmed_at is not null
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

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
  if old.public_key is not null and new.public_key is null then
    raise exception 'A device public key cannot be removed.';
  end if;
  if new.public_key is not null and not public.is_valid_public_key(new.public_key) then
    raise exception 'Invalid device public key.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_username_immutable on public.profiles;
create trigger profiles_username_immutable
before update on public.profiles
for each row execute function public.prevent_username_change();

create or replace function public.is_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = p_user_id
  );
$$;

create or replace function public.is_conversation_admin(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = p_user_id
      and role = 'admin'
  );
$$;

create or replace function public.shares_conversation(p_other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.conversation_members mine
    join public.conversation_members theirs
      on theirs.conversation_id = mine.conversation_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user
  );
$$;

-- ---------------------------------------------------------- auth triggers ----

create or replace function public.enforce_email_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  email_domain text;
begin
  if new.email is null or new.email = '' or char_length(new.email) > 254 then
    raise exception 'An email address is required.';
  end if;

  email_domain := lower(split_part(new.email, '@', 2));

  if email_domain = '' or email_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'Please use a valid email address.';
  end if;

  if exists (
    select 1
    from public.blocked_email_domains b
    where b.domain = email_domain
       or email_domain like '%.' || b.domain
  ) then
    raise exception 'Disposable email domains are not supported.';
  end if;

  return new;
end;
$$;

drop trigger if exists sotto_enforce_email_policy on auth.users;
create trigger sotto_enforce_email_policy
before insert on auth.users
for each row execute function public.enforce_email_policy();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uname text;
  dname text;
  pkey jsonb;
begin
  uname := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  dname := trim(coalesce(new.raw_user_meta_data ->> 'display_name', uname));
  pkey := new.raw_user_meta_data -> 'public_key';

  if uname !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Invalid username.';
  end if;
  if uname = any (array[
    'admin', 'administrator', 'api', 'help', 'mail', 'moderator', 'null',
    'official', 'root', 'security', 'sotto', 'support', 'system', 'team',
    'undefined', 'www'
  ]) then
    raise exception 'That username is reserved.';
  end if;
  if char_length(dname) < 1 or char_length(dname) > 48 then
    raise exception 'Display name must be between 1 and 48 characters.';
  end if;
  if not public.is_valid_public_key(pkey) then
    raise exception 'A valid device public key is required.';
  end if;

  -- Reclaim usernames held by abandoned unconfirmed signups older than 24h.
  delete from auth.users u
  using public.profiles p
  where p.id = u.id
    and p.username = uname
    and u.id <> new.id
    and u.email_confirmed_at is null
    and u.created_at <= now() - interval '24 hours';

  insert into public.profiles (id, username, display_name, public_key)
  values (new.id, uname, dname, pkey);

  return new;
end;
$$;

drop trigger if exists sotto_handle_new_user on auth.users;
create trigger sotto_handle_new_user
after insert on auth.users
for each row execute function public.handle_new_user();

-- --------------------------------------------------------------- RPCs ------

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    lower(trim(p_username)) ~ '^[a-z0-9_]{3,24}$'
    and lower(trim(p_username)) <> all (array[
      'admin', 'administrator', 'api', 'help', 'mail', 'moderator', 'null',
      'official', 'root', 'security', 'sotto', 'support', 'system', 'team',
      'undefined', 'www'
    ])
    and not exists (
      select 1
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.username = lower(trim(p_username))
        and (
          u.email_confirmed_at is not null
          or u.created_at > now() - interval '24 hours'
        )
    );
$$;

-- Discovery only returns verified profiles that have completed device setup.
-- Prefix matching avoids wildcard injection and keeps enumeration noisy.
create or replace function public.search_people(p_query text)
returns table (id uuid, username text, display_name text, public_key jsonb)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  clean_query text := lower(trim(coalesce(p_query, '')));
begin
  perform public.enforce_rate_limit('search_people', 60, 60);

  if char_length(clean_query) < 2 or char_length(clean_query) > 40 then
    return;
  end if;

  return query
    select p.id, p.username, p.display_name, p.public_key
    from public.profiles p
    join auth.users u on u.id = p.id
    where auth.uid() is not null
      and p.id <> auth.uid()
      and p.public_key is not null
      and u.email_confirmed_at is not null
      and starts_with(p.username, clean_query)
    order by p.username
    limit 12;
end;
$$;

create or replace function public.start_dm(p_username text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  other uuid;
  pair_key text;
  cid uuid;
begin
  if me is null then raise exception 'Not authenticated.'; end if;
  if not public.is_confirmed_user(me) then
    raise exception 'Confirm your email before starting conversations.';
  end if;
  perform public.enforce_rate_limit('start_dm', 25, 60);

  select p.id into other
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(trim(p_username))
    and p.public_key is not null
    and u.email_confirmed_at is not null;

  if other is null then raise exception 'That username does not exist.'; end if;
  if other = me then raise exception 'You cannot message yourself.'; end if;

  pair_key := least(me::text, other::text) || ':' || greatest(me::text, other::text);

  insert into public.conversations (kind, dm_key, created_by)
  values ('dm', pair_key, me)
  on conflict (dm_key) do nothing;

  select id into cid from public.conversations where dm_key = pair_key;
  if cid is null then raise exception 'Unable to create the conversation.'; end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (cid, me, 'member'), (cid, other, 'member')
  on conflict do nothing;

  return cid;
end;
$$;

create or replace function public.create_group(p_title text, p_usernames text[])
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  member_ids uuid[];
begin
  if me is null then raise exception 'Not authenticated.'; end if;
  if not public.is_confirmed_user(me) then
    raise exception 'Confirm your email before creating a group.';
  end if;
  perform public.enforce_rate_limit('create_group', 12, 300);

  if char_length(trim(p_title)) < 1 or char_length(trim(p_title)) > 64 then
    raise exception 'Group name must be between 1 and 64 characters.';
  end if;
  if p_usernames is null or array_length(p_usernames, 1) is null then
    raise exception 'Add at least one other person.';
  end if;

  select array_agg(distinct p.id)
  into member_ids
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = any (select lower(trim(unnest(p_usernames))))
    and p.public_key is not null
    and u.email_confirmed_at is not null
    and p.id <> me;

  if coalesce(array_length(member_ids, 1), 0) < 1 then
    raise exception 'Add at least one other person.';
  end if;
  if array_length(member_ids, 1) > 49 then
    raise exception 'Groups are limited to 50 people.';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', trim(p_title), me)
  returning id into cid;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (cid, me, 'admin');

  insert into public.conversation_members (conversation_id, user_id, role)
  select cid, unnest(member_ids), 'member'
  on conflict do nothing;

  return cid;
end;
$$;

create or replace function public.add_group_member(p_conversation_id uuid, p_username text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  other uuid;
  count_members int;
  group_title text;
begin
  if not public.is_conversation_admin(p_conversation_id, me) then
    raise exception 'Only group admins can add people.';
  end if;
  perform public.enforce_rate_limit('add_group_member', 30, 60);

  select title into group_title from public.conversations
  where id = p_conversation_id and kind = 'group';
  if group_title is null then raise exception 'Group not found.'; end if;

  select p.id into other
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(trim(p_username))
    and p.public_key is not null
    and u.email_confirmed_at is not null;
  if other is null then raise exception 'That username does not exist.'; end if;

  select count(*) into count_members
  from public.conversation_members where conversation_id = p_conversation_id;
  if count_members >= 50 then raise exception 'Groups are limited to 50 people.'; end if;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (p_conversation_id, other, 'member')
  on conflict do nothing;

  return other;
end;
$$;

create or replace function public.remove_group_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  remaining int;
begin
  if not public.is_conversation_admin(p_conversation_id, me) then
    raise exception 'Only group admins can remove people.';
  end if;
  if p_user_id = me then
    raise exception 'Use Leave group to remove yourself.';
  end if;

  delete from public.conversation_keys
  where conversation_id = p_conversation_id and user_id = p_user_id;

  delete from public.conversation_members
  where conversation_id = p_conversation_id and user_id = p_user_id;

  select count(*) into remaining
  from public.conversation_members where conversation_id = p_conversation_id;

  if remaining = 0 then
    delete from public.conversations where id = p_conversation_id;
  end if;
end;
$$;

create or replace function public.leave_group(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  was_admin boolean;
  remaining int;
  next_admin uuid;
begin
  select role = 'admin' into was_admin
  from public.conversation_members
  where conversation_id = p_conversation_id and user_id = me;

  if was_admin is null then raise exception 'You are not in that group.'; end if;

  delete from public.conversation_keys
  where conversation_id = p_conversation_id and user_id = me;

  delete from public.conversation_members
  where conversation_id = p_conversation_id and user_id = me;

  select count(*) into remaining
  from public.conversation_members where conversation_id = p_conversation_id;

  if remaining = 0 then
    delete from public.conversations where id = p_conversation_id;
    return;
  end if;

  if was_admin then
    select user_id into next_admin
    from public.conversation_members
    where conversation_id = p_conversation_id
    order by joined_at
    limit 1;

    update public.conversation_members
    set role = 'admin'
    where conversation_id = p_conversation_id and user_id = next_admin;
  end if;
end;
$$;

create or replace function public.rename_group(p_conversation_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_conversation_admin(p_conversation_id, auth.uid()) then
    raise exception 'Only group admins can rename the group.';
  end if;
  perform public.enforce_rate_limit('rename_group', 15, 60);

  if char_length(trim(p_title)) < 1 or char_length(trim(p_title)) > 64 then
    raise exception 'Group name must be between 1 and 64 characters.';
  end if;

  update public.conversations
  set title = trim(p_title)
  where id = p_conversation_id and kind = 'group';
end;
$$;

-- Any member may provision the conversation key for the current membership.
-- The sender identity and public key are resolved server-side, never trusted
-- from the request body, and every active member must receive a key in this
-- exact transaction so no member can be silently partitioned onto an old key.
create or replace function public.set_conversation_keys(
  p_conversation_id uuid,
  p_keys jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  my_public_key jsonb;
  item jsonb;
  target uuid;
  wrapped text;
  iv text;
  count_keys int;
  seen_targets uuid[] := '{}';
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'You are not a member of this conversation.';
  end if;
  perform public.enforce_rate_limit('set_conversation_keys', 40, 60);

  select public_key into my_public_key
  from public.profiles
  where id = me;

  if not public.is_valid_public_key(my_public_key) then
    raise exception 'Complete device setup before sharing keys.';
  end if;

  if jsonb_typeof(p_keys) <> 'array' then
    raise exception 'Keys must be an array.';
  end if;

  count_keys := jsonb_array_length(p_keys);
  if count_keys < 1 or count_keys > 50 then
    raise exception 'Invalid number of conversation keys.';
  end if;

  for item in select * from jsonb_array_elements(p_keys)
  loop
    target := (item ->> 'user_id')::uuid;
    wrapped := item ->> 'wrapped_key';
    iv := item ->> 'wrap_iv';

    if target is null
       or not public.is_conversation_member(p_conversation_id, target) then
      raise exception 'A key target is not a member of this conversation.';
    end if;
    if target = any (seen_targets) then
      raise exception 'Duplicate key target in rotation payload.';
    end if;
    seen_targets := array_append(seen_targets, target);

    if wrapped is null or char_length(wrapped) not between 16 and 4096 then
      raise exception 'Invalid wrapped key.';
    end if;
    if iv is null or char_length(iv) not between 8 and 128 then
      raise exception 'Invalid key nonce.';
    end if;

    insert into public.conversation_keys (
      conversation_id, user_id, wrapped_key, wrap_iv, from_user, from_public_key, updated_at
    ) values (
      p_conversation_id, target, wrapped, iv, me, my_public_key, now()
    )
    on conflict (conversation_id, user_id) do update
      set wrapped_key = excluded.wrapped_key,
          wrap_iv = excluded.wrap_iv,
          from_user = excluded.from_user,
          from_public_key = excluded.from_public_key,
          updated_at = now();
  end loop;

  -- Every current member with a device public key must be covered in THIS
  -- exact transaction (`updated_at = now()`), preventing key-partitioning.
  if exists (
    select 1
    from public.conversation_members m
    join public.profiles p on p.id = m.user_id
    where m.conversation_id = p_conversation_id
      and p.public_key is not null
      and not (m.user_id = any (seen_targets))
  ) then
    raise exception 'Every current member needs a fresh conversation key.';
  end if;
end;
$$;

drop function if exists public.set_group_keys(uuid, jsonb);

-- Deletes the signed-in account and all dependent rows. Group ownership is
-- transferred before the profile disappears so no group is left unmanaged.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  group_row record;
begin
  if me is null then raise exception 'Not authenticated.'; end if;

  for group_row in
    select c.id
    from public.conversations c
    join public.conversation_members m on m.conversation_id = c.id
    where m.user_id = me
      and m.role = 'admin'
      and c.kind = 'group'
  loop
    update public.conversation_members
    set role = 'admin'
    where conversation_id = group_row.id
      and user_id = (
        select user_id
        from public.conversation_members
        where conversation_id = group_row.id
          and user_id <> me
        order by joined_at
        limit 1
      );
  end loop;

  -- Direct messages have no meaning without both participants.
  delete from public.conversations c
  using public.conversation_members m
  where m.conversation_id = c.id
    and m.user_id = me
    and c.kind = 'dm';

  delete from public.rate_limits where user_id = me;
  delete from auth.users where id = me;

  -- A group whose last member was just removed must not remain as an orphan.
  delete from public.conversations c
  where c.kind = 'group'
    and not exists (
      select 1 from public.conversation_members m where m.conversation_id = c.id
    );
end;
$$;

-- ------------------------------------------------------------------- RLS ----

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_keys enable row level security;
alter table public.blocked_email_domains enable row level security;
alter table public.rate_limits enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or public.shares_conversation(id)
);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists conversations_select_member on public.conversations;
create policy conversations_select_member on public.conversations
for select to authenticated
using (public.is_conversation_member(id));

drop policy if exists conversation_members_select_member on public.conversation_members;
create policy conversation_members_select_member on public.conversation_members
for select to authenticated
using (public.is_conversation_member(conversation_id));

drop policy if exists conversation_keys_select_own on public.conversation_keys;
create policy conversation_keys_select_own on public.conversation_keys
for select to authenticated
using (user_id = auth.uid());

-- --------------------------------------------------------------- grants ----

grant usage on schema public to anon, authenticated;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, public_key) on public.profiles to authenticated;

revoke all on public.conversations, public.conversation_members, public.conversation_keys
  from anon, authenticated;
grant select on public.conversations, public.conversation_members, public.conversation_keys
  to authenticated;

revoke all on public.blocked_email_domains from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;

revoke all on function public.is_valid_public_key(jsonb) from public;
grant execute on function public.is_valid_public_key(jsonb) to anon, authenticated;

revoke all on function public.enforce_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function public.is_confirmed_user(uuid) from public, anon;
grant execute on function public.is_confirmed_user(uuid) to authenticated;

revoke all on function public.is_conversation_member(uuid, uuid) from public, anon;
revoke all on function public.is_conversation_admin(uuid, uuid) from public, anon;
revoke all on function public.shares_conversation(uuid) from public, anon;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.is_conversation_admin(uuid, uuid) to authenticated;
grant execute on function public.shares_conversation(uuid) to authenticated;

revoke all on function public.is_username_available(text) from public;
revoke all on function public.search_people(text) from public;
revoke all on function public.start_dm(text) from public;
revoke all on function public.create_group(text, text[]) from public;
revoke all on function public.add_group_member(uuid, text) from public;
revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.rename_group(uuid, text) from public;
revoke all on function public.set_conversation_keys(uuid, jsonb) from public;
revoke all on function public.delete_account() from public;

grant execute on function public.is_username_available(text) to anon, authenticated;
grant execute on function public.search_people(text) to authenticated;
grant execute on function public.start_dm(text) to authenticated;
grant execute on function public.create_group(text, text[]) to authenticated;
grant execute on function public.add_group_member(uuid, text) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.set_conversation_keys(uuid, jsonb) to authenticated;
grant execute on function public.delete_account() to authenticated;

-- ------------------------------------------------------ realtime policies ----
-- Private channels authorise each broadcast through RLS on realtime.messages.
-- A member can use conversation:<id> topics for conversations they belong to,
-- and can only read their own user:<id> call inbox. Any conversation peer can
-- write to that inbox so call offers reach the callee; every envelope is
-- signed with the sender's device key and verified on receipt.

do $$
begin
  if not coalesce((
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'realtime' and c.relname = 'messages'
  ), false) then
    alter table realtime.messages enable row level security;
  end if;
end;
$$;

drop policy if exists sotto_realtime_conversation_read on realtime.messages;
create policy sotto_realtime_conversation_read on realtime.messages
for select to authenticated
using (
  realtime.topic() ~ '^conversation:[0-9a-f-]{36}$'
  and public.is_conversation_member((split_part(realtime.topic(), ':', 2))::uuid)
);

drop policy if exists sotto_realtime_conversation_write on realtime.messages;
create policy sotto_realtime_conversation_write on realtime.messages
for insert to authenticated
with check (
  realtime.topic() ~ '^conversation:[0-9a-f-]{36}$'
  and public.is_conversation_member((split_part(realtime.topic(), ':', 2))::uuid)
);

drop policy if exists sotto_realtime_user_read on realtime.messages;
create policy sotto_realtime_user_read on realtime.messages
for select to authenticated
using (
  realtime.topic() ~ '^user:[0-9a-f-]{36}$'
  and (split_part(realtime.topic(), ':', 2))::uuid = auth.uid()
);

drop policy if exists sotto_realtime_user_write on realtime.messages;
create policy sotto_realtime_user_write on realtime.messages
for insert to authenticated
with check (
  realtime.topic() ~ '^user:[0-9a-f-]{36}$'
  and (
    (split_part(realtime.topic(), ':', 2))::uuid = auth.uid()
    or public.shares_conversation((split_part(realtime.topic(), ':', 2))::uuid)
  )
);
