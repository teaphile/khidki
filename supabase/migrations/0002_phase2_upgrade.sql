-- Phase 2 Security, Messaging, Calling, Quotas & Profile Sticker Upgrade
-- Protects Supabase Free Tier storage while enabling:
--   1. Strict usernames: ^[a-z0-9]{3,10}$ only
--   2. Trusted real-inbox email policy + canonical Gmail deduplication + 30m unconfirmed cleanup
--   3. Lightweight profile DP stickers (avatar_id) + owner-isolated encrypted key vault (profile_vaults)
--   4. Message Requests (pending / accepted) with accept & decline RPCs
--   5. Immutable end-to-end encrypted message queue with Seen + 2 Minutes automatic self-clean
--   6. Ephemeral 60-second encrypted WebRTC call signal relay for rock-solid mobile calling

-- --------------------------------------------------------- validators -------

create or replace function public.is_valid_avatar_id(p_avatar text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p_avatar = any (array[
    'initials', 'fox', 'owl', 'cat', 'wolf', 'panda', 'crown', 'bolt',
    'flame', 'moon', 'star', 'lotus', 'gem', 'wave', 'shield', 'music', 'rocket'
  ]);
$$;

create or replace function public.is_valid_key_vault(kv jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select
    kv is not null
    and jsonb_typeof(kv) = 'object'
    and octet_length(kv::text) <= 4096
    and kv -> 'v' = '1'::jsonb
    and jsonb_typeof(kv -> 'iter') = 'number'
    and (kv ->> 'iter')::int between 100000 and 600000
    and char_length(coalesce(kv ->> 'salt', '')) between 16 and 64
    and char_length(coalesce(kv ->> 'iv', '')) between 12 and 48
    and char_length(coalesce(kv ->> 'ct', '')) between 64 and 3600;
$$;

create or replace function public.canonicalize_email(p_email text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  cleaned text := lower(trim(coalesce(p_email, '')));
  local_part text := split_part(cleaned, '@', 1);
  domain_part text := split_part(cleaned, '@', 2);
begin
  if local_part = '' or domain_part = '' then
    return cleaned;
  end if;
  local_part := split_part(local_part, '+', 1);
  if domain_part in ('gmail.com', 'googlemail.com') then
    local_part := replace(local_part, '.', '');
    domain_part := 'gmail.com';
  end if;
  return local_part || '@' || domain_part;
end;
$$;

-- ---------------------------------------------------- profile upgrades ------

alter table public.profiles
  add column if not exists avatar_id text not null default 'initials',
  add column if not exists canonical_email text;

alter table public.profiles
  drop constraint if exists profiles_avatar_id_check;

alter table public.profiles
  add constraint profiles_avatar_id_check
  check (public.is_valid_avatar_id(avatar_id));

-- Normalize any pre-existing test rows before tightening username constraint
delete from public.profiles
where username !~ '^[a-z0-9]{3,10}$';

alter table public.profiles
  drop constraint if exists profiles_username_check;

alter table public.profiles
  add constraint profiles_username_check
  check (username = lower(username) and username ~ '^[a-z0-9]{3,10}$');

alter table public.profiles
  drop constraint if exists profiles_display_name_check;

alter table public.profiles
  add constraint profiles_display_name_check
  check (char_length(display_name) between 1 and 36);

create unique index if not exists profiles_canonical_email_idx
  on public.profiles (canonical_email)
  where canonical_email is not null;

-- Owner-isolated encrypted key vault (invisible even to conversation peers)
create table if not exists public.profile_vaults (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  key_vault jsonb not null check (public.is_valid_key_vault(key_vault)),
  updated_at timestamptz not null default now()
);

drop trigger if exists profile_vaults_set_updated_at on public.profile_vaults;
create trigger profile_vaults_set_updated_at
before update on public.profile_vaults
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
  if new.canonical_email is distinct from old.canonical_email and old.canonical_email is not null then
    raise exception 'Canonical email cannot be changed.';
  end if;
  if old.public_key is not null and new.public_key is null then
    raise exception 'A device public key cannot be removed.';
  end if;
  if new.public_key is not null and not public.is_valid_public_key(new.public_key) then
    raise exception 'Invalid device public key.';
  end if;
  if not public.is_valid_avatar_id(new.avatar_id) then
    raise exception 'Invalid profile sticker.';
  end if;
  return new;
end;
$$;

-- ------------------------------------------- email & signup hardening -------

insert into public.blocked_email_domains (domain) values
  ('example.com'), ('example.net'), ('example.org'),
  ('invalid.com'), ('test.com'), ('test.org')
on conflict (domain) do nothing;

create or replace function public.enforce_email_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cleaned text := lower(trim(coalesce(new.email, '')));
  local_part text;
  email_domain text;
  canon text;
begin
  -- Proactively purge abandoned unverified signups older than 30 minutes
  -- so fake signups can never accumulate in cloud storage.
  delete from auth.users u
  where u.email_confirmed_at is null
    and u.created_at <= now() - interval '30 minutes';

  if cleaned = '' or char_length(cleaned) > 254 then
    raise exception 'An email address is required.';
  end if;

  local_part := split_part(cleaned, '@', 1);
  email_domain := split_part(cleaned, '@', 2);

  if local_part = '' or email_domain = '' or email_domain !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'Enter a valid email address.';
  end if;

  if position('+' in local_part) > 0 then
    raise exception 'Email + aliases are not allowed.';
  end if;

  if exists (
    select 1
    from public.blocked_email_domains b
    where b.domain = email_domain
       or email_domain like '%.' || b.domain
  ) then
    raise exception 'Temporary or disposable email domains are not allowed.';
  end if;

  if not (
    email_domain = any (array[
      'gmail.com', 'googlemail.com',
      'outlook.com', 'outlook.in', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
      'icloud.com', 'me.com', 'mac.com',
      'yahoo.com', 'yahoo.in', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com',
      'proton.me', 'protonmail.com', 'pm.me',
      'zoho.com', 'zohomail.com', 'zohomail.in',
      'aol.com', 'fastmail.com',
      'tuta.com', 'tutamail.com', 'tutanota.com',
      'gmx.com', 'gmx.de', 'mail.com', 'rediffmail.com', 'hey.com'
    ])
    or email_domain like '%.edu'
    or email_domain like '%.ac.in'
    or email_domain like '%.edu.in'
  ) then
    raise exception 'Use a trusted email provider such as Gmail, Outlook, iCloud, Yahoo, Proton, or Zoho.';
  end if;

  canon := public.canonicalize_email(cleaned);
  if exists (
    select 1
    from public.profiles p
    where p.canonical_email = canon
  ) then
    raise exception 'An account with that email already exists.';
  end if;

  return new;
end;
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
  av_id text;
  pkey jsonb;
  kv jsonb;
  canon text;
begin
  uname := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  dname := trim(coalesce(new.raw_user_meta_data ->> 'display_name', uname));
  av_id := coalesce(new.raw_user_meta_data ->> 'avatar_id', 'initials');
  pkey := new.raw_user_meta_data -> 'public_key';
  kv := new.raw_user_meta_data -> 'key_vault';
  canon := public.canonicalize_email(new.email);

  if uname !~ '^[a-z0-9]{3,10}$' then
    raise exception 'Usernames must be 3 to 10 characters using only a-z and 0-9.';
  end if;

  if uname = any (array[
    'admin', 'api', 'help', 'mail', 'mod', 'null',
    'official', 'root', 'security', 'sotto', 'support', 'system', 'team', 'www'
  ]) then
    raise exception 'That username is reserved.';
  end if;

  if char_length(dname) < 1 or char_length(dname) > 36 then
    raise exception 'Display name must be between 1 and 36 characters.';
  end if;

  if not public.is_valid_avatar_id(av_id) then
    av_id := 'initials';
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

  insert into public.profiles (id, username, display_name, avatar_id, public_key, canonical_email)
  values (new.id, uname, dname, av_id, pkey, canon);

  if kv is not null and jsonb_typeof(kv) = 'object' and public.is_valid_key_vault(kv) then
    insert into public.profile_vaults (user_id, key_vault)
    values (new.id, kv)
    on conflict (user_id) do update set key_vault = excluded.key_vault, updated_at = now();
  end if;

  return new;
end;
$$;

-- ------------------------------------------- conversations & requests -------

alter table public.conversations
  add column if not exists request_status text not null default 'accepted',
  add column if not exists requested_by uuid references public.profiles (id) on delete set null,
  add column if not exists last_message_at timestamptz not null default now();

alter table public.conversations
  drop constraint if exists conversations_request_status_check;

alter table public.conversations
  add constraint conversations_request_status_check
  check (request_status in ('pending', 'accepted'));

create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc);

-- ---------------------------------------- immutable encrypted messages ------

create table if not exists public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('text', 'file')),
  iv text not null check (char_length(iv) between 12 and 64),
  ciphertext text not null check (char_length(ciphertext) between 16 and 400000),
  sig text not null check (char_length(sig) between 40 and 256),
  byte_size int not null check (byte_size between 1 and 400000),
  client_created_at bigint not null check (client_created_at > 0),
  created_at timestamptz not null default now(),
  seen_at timestamptz,
  expires_at timestamptz,
  seen_by uuid[] not null default '{}'
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, client_created_at asc);

create index if not exists messages_expires_at_idx
  on public.messages (expires_at)
  where expires_at is not null;

create index if not exists messages_sender_unseen_idx
  on public.messages (sender_id)
  where seen_at is null;

-- Prevent ANY editing of message content, signature, sender, or metadata
create or replace function public.prevent_message_tampering()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.kind is distinct from old.kind
     or new.iv is distinct from old.iv
     or new.ciphertext is distinct from old.ciphertext
     or new.sig is distinct from old.sig
     or new.byte_size is distinct from old.byte_size
     or new.client_created_at is distinct from old.client_created_at
     or new.created_at is distinct from old.created_at then
    raise exception 'Messages are immutable and cannot be edited.';
  end if;

  if old.seen_at is not null and new.seen_at is distinct from old.seen_at then
    raise exception 'Seen timestamp cannot be altered once set.';
  end if;

  if old.expires_at is not null and new.expires_at is distinct from old.expires_at then
    raise exception 'Expiry timestamp cannot be extended once set.';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_immutable_guard on public.messages;
create trigger messages_immutable_guard
before update on public.messages
for each row execute function public.prevent_message_tampering();

-- ------------------------------------------- ephemeral call signaling -------

create table if not exists public.call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  event text not null check (event in ('call-offer', 'call-answer', 'call-ice', 'call-decline', 'call-end')),
  envelope jsonb not null check (octet_length(envelope::text) <= 98304),
  created_at timestamptz not null default now()
);

create index if not exists call_signals_recipient_created_idx
  on public.call_signals (recipient_id, created_at asc);

create index if not exists call_signals_call_id_idx
  on public.call_signals (call_id);

-- ------------------------------------------- self-cleaning & RPCs -----------

create or replace function public.purge_expired_messages()
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  removed int := 0;
begin
  delete from public.messages
  where (expires_at is not null and expires_at <= now())
     or created_at <= now() - interval '14 days';
  get diagnostics removed = row_count;

  delete from public.call_signals
  where created_at <= now() - interval '60 seconds';

  delete from public.rate_limits
  where reset_at <= now() - interval '10 minutes';

  return removed;
end;
$$;

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
      'admin', 'api', 'help', 'mail', 'mod', 'null',
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

drop function if exists public.search_people(text);

create or replace function public.search_people(p_query text)
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_id text,
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
    select p.id, p.username, p.display_name, p.avatar_id, p.public_key
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
  outgoing_pending int;
begin
  if me is null then raise exception 'Not authenticated.'; end if;
  if not public.is_confirmed_user(me) then
    raise exception 'Confirm your email before starting conversations.';
  end if;
  perform public.enforce_rate_limit('start_dm', 25, 60);
  perform public.purge_expired_messages();

  select p.id into other
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(trim(p_username))
    and p.public_key is not null
    and u.email_confirmed_at is not null;

  if other is null then raise exception 'That username does not exist or has not verified email yet.'; end if;
  if other = me then raise exception 'You cannot message yourself.'; end if;

  pair_key := least(me::text, other::text) || ':' || greatest(me::text, other::text);

  select id into cid
  from public.conversations
  where dm_key = pair_key;

  if cid is not null then
    return cid;
  end if;

  select count(*) into outgoing_pending
  from public.conversations c
  where c.kind = 'dm'
    and c.request_status = 'pending'
    and c.requested_by = me;

  if outgoing_pending >= 20 then
    raise exception 'You have too many unanswered message requests. Wait for replies first.';
  end if;

  insert into public.conversations (kind, dm_key, created_by, request_status, requested_by, last_message_at)
  values ('dm', pair_key, me, 'pending', me, now())
  on conflict (dm_key) do update set dm_key = excluded.dm_key
  returning id into cid;

  insert into public.conversation_members (conversation_id, user_id, role)
  values (cid, me, 'member'), (cid, other, 'member')
  on conflict do nothing;

  return cid;
end;
$$;

create or replace function public.accept_message_request(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conv_kind text;
  req_status text;
  req_by uuid;
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'Conversation not found.';
  end if;
  perform public.enforce_rate_limit('accept_request', 30, 60);

  select kind, request_status, requested_by
  into conv_kind, req_status, req_by
  from public.conversations
  where id = p_conversation_id;

  if conv_kind <> 'dm' then
    return;
  end if;

  if req_status = 'pending' and req_by is distinct from me then
    update public.conversations
    set request_status = 'accepted',
        last_message_at = now()
    where id = p_conversation_id;
  end if;
end;
$$;

create or replace function public.decline_message_request(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conv_kind text;
  req_status text;
begin
  if me is null or not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'Conversation not found.';
  end if;
  perform public.enforce_rate_limit('decline_request', 30, 60);

  select kind, request_status
  into conv_kind, req_status
  from public.conversations
  where id = p_conversation_id;

  if conv_kind <> 'dm' or req_status <> 'pending' then
    raise exception 'Only pending message requests can be removed.';
  end if;

  -- Deleting a pending request cascades to members, keys, and queued ciphertexts
  delete from public.conversations where id = p_conversation_id;
end;
$$;

create or replace function public.send_encrypted_message(
  p_id uuid,
  p_conversation_id uuid,
  p_kind text,
  p_iv text,
  p_ciphertext text,
  p_sig text,
  p_byte_size int,
  p_client_created_at bigint
)
returns public.messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conv_kind text;
  req_status text;
  req_by uuid;
  conv_queued int;
  user_bytes bigint;
  inserted public.messages;
begin
  if me is null or not public.is_confirmed_user(me) then
    raise exception 'Confirm your email before sending messages.';
  end if;
  if not public.is_conversation_member(p_conversation_id, me) then
    raise exception 'You are not a member of this conversation.';
  end if;

  perform public.enforce_rate_limit('send_message', 45, 60);
  perform public.purge_expired_messages();

  if p_kind not in ('text', 'file') then
    raise exception 'Invalid message kind.';
  end if;
  if p_kind = 'text' and char_length(p_ciphertext) > 20000 then
    raise exception 'Text message exceeds size limit.';
  end if;
  if char_length(p_ciphertext) > 400000 or p_byte_size > 400000 or p_byte_size <> char_length(p_ciphertext) then
    raise exception 'Attachment exceeds the 256 KB cloud storage limit.';
  end if;

  select kind, request_status, requested_by
  into conv_kind, req_status, req_by
  from public.conversations
  where id = p_conversation_id;

  -- If the recipient replies directly, promote the request to accepted
  if conv_kind = 'dm' and req_status = 'pending' and req_by is distinct from me then
    update public.conversations
    set request_status = 'accepted'
    where id = p_conversation_id;
    req_status := 'accepted';
  end if;

  -- Protect recipient & cloud storage on unaccepted message requests
  if conv_kind = 'dm' and req_status = 'pending' then
    if p_kind = 'file' then
      raise exception 'Attachments unlock once the message request is accepted.';
    end if;
    select count(*) into conv_queued
    from public.messages
    where conversation_id = p_conversation_id;
    if conv_queued >= 10 then
      raise exception 'Wait for your message request to be accepted before sending more messages.';
    end if;
  end if;

  -- Protect Supabase Free Tier storage with strict per-conversation and per-user unseen caps
  select count(*) into conv_queued
  from public.messages
  where conversation_id = p_conversation_id
    and seen_at is null;
  if conv_queued >= 200 then
    raise exception 'This chat has reached the 200 unseen offline message limit.';
  end if;

  select coalesce(sum(byte_size), 0) into user_bytes
  from public.messages
  where sender_id = me
    and seen_at is null;
  if user_bytes + p_byte_size > 4194304 then
    raise exception 'Your pending unseen attachments reached the 4 MB Free Tier quota. Wait for your contact to view earlier files.';
  end if;

  insert into public.messages (
    id, conversation_id, sender_id, kind, iv, ciphertext, sig, byte_size, client_created_at
  ) values (
    p_id, p_conversation_id, me, p_kind, p_iv, p_ciphertext, p_sig, p_byte_size, p_client_created_at
  )
  returning * into inserted;

  update public.conversations
  set last_message_at = now()
  where id = p_conversation_id;

  return inserted;
end;
$$;

create or replace function public.mark_conversation_seen(p_conversation_id uuid)
returns table (
  id uuid,
  seen_at timestamptz,
  expires_at timestamptz
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
  exp timestamptz := stamp + interval '2 minutes';
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
      returning m.id, m.seen_at, m.expires_at;
  else
    select greatest(count(*) - 1, 1) into other_member_count
    from public.conversation_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.conversation_id = p_conversation_id
      and p.public_key is not null;

    update public.messages m
    set seen_by = array_append(m.seen_by, me)
    where m.conversation_id = p_conversation_id
      and m.sender_id <> me
      and not (me = any (m.seen_by));

    return query
      update public.messages m
      set seen_at = coalesce(m.seen_at, stamp),
          expires_at = coalesce(m.expires_at, exp)
      where m.conversation_id = p_conversation_id
        and m.sender_id <> me
        and m.seen_at is null
        and coalesce(array_length(m.seen_by, 1), 0) >= other_member_count
      returning m.id, m.seen_at, m.expires_at;
  end if;
end;
$$;

create or replace function public.store_call_signal(
  p_call_id uuid,
  p_conversation_id uuid,
  p_recipient_id uuid,
  p_event text,
  p_envelope jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
  conv_kind text;
  req_status text;
begin
  if me is null then raise exception 'Not authenticated.'; end if;
  if me = p_recipient_id then return; end if;

  perform public.enforce_rate_limit('call_signal', 180, 60);

  select kind, request_status into conv_kind, req_status
  from public.conversations
  where id = p_conversation_id;

  if conv_kind <> 'dm' or req_status <> 'accepted' then
    raise exception 'Calls are only available in accepted direct chats.';
  end if;

  if not public.is_conversation_member(p_conversation_id, me)
     or not public.is_conversation_member(p_conversation_id, p_recipient_id) then
    raise exception 'Invalid call participants.';
  end if;

  delete from public.call_signals
  where created_at <= now() - interval '60 seconds';

  insert into public.call_signals (
    call_id, conversation_id, sender_id, recipient_id, event, envelope
  ) values (
    p_call_id, p_conversation_id, me, p_recipient_id, p_event, p_envelope
  );
end;
$$;

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
      and (p_since is null or s.created_at > p_since)
    order by s.created_at asc
    limit 80;
end;
$$;

create or replace function public.clear_call_signals(p_call_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return; end if;
  delete from public.call_signals
  where call_id = p_call_id
    and (sender_id = me or recipient_id = me);
end;
$$;

-- ------------------------------------------------------- RLS & Grants -------

alter table public.profile_vaults enable row level security;
alter table public.messages enable row level security;
alter table public.call_signals enable row level security;

drop policy if exists profile_vaults_select_own on public.profile_vaults;
create policy profile_vaults_select_own on public.profile_vaults
for select to authenticated
using (user_id = auth.uid());

drop policy if exists profile_vaults_insert_own on public.profile_vaults;
create policy profile_vaults_insert_own on public.profile_vaults
for insert to authenticated
with check (user_id = auth.uid());

drop policy if exists profile_vaults_update_own on public.profile_vaults;
create policy profile_vaults_update_own on public.profile_vaults
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists messages_select_member on public.messages;
create policy messages_select_member on public.messages
for select to authenticated
using (
  public.is_conversation_member(conversation_id)
  and (expires_at is null or expires_at > now())
);

-- Table-level grants: strictly NO update or delete on messages for clients!
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_id, public_key) on public.profiles to authenticated;

revoke all on public.profile_vaults from anon, authenticated;
grant select, insert, update on public.profile_vaults to authenticated;

revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

revoke all on public.call_signals from anon, authenticated;

revoke all on function public.is_valid_avatar_id(text) from public;
revoke all on function public.is_valid_key_vault(jsonb) from public;
revoke all on function public.canonicalize_email(text) from public;
grant execute on function public.is_valid_avatar_id(text) to anon, authenticated;
grant execute on function public.is_valid_key_vault(jsonb) to authenticated;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

revoke all on function public.purge_expired_messages() from public, anon;
revoke all on function public.search_people(text) from public, anon;
revoke all on function public.accept_message_request(uuid) from public, anon;
revoke all on function public.decline_message_request(uuid) from public, anon;
revoke all on function public.send_encrypted_message(uuid, uuid, text, text, text, text, int, bigint) from public, anon;
revoke all on function public.mark_conversation_seen(uuid) from public, anon;
revoke all on function public.store_call_signal(uuid, uuid, uuid, text, jsonb) from public, anon;
revoke all on function public.poll_call_signals(timestamptz) from public, anon;
revoke all on function public.clear_call_signals(uuid) from public, anon;

grant execute on function public.purge_expired_messages() to authenticated;
grant execute on function public.search_people(text) to authenticated;
grant execute on function public.accept_message_request(uuid) to authenticated;
grant execute on function public.decline_message_request(uuid) to authenticated;
grant execute on function public.send_encrypted_message(uuid, uuid, text, text, text, text, int, bigint) to authenticated;
grant execute on function public.mark_conversation_seen(uuid) to authenticated;
grant execute on function public.store_call_signal(uuid, uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.poll_call_signals(timestamptz) to authenticated;
grant execute on function public.clear_call_signals(uuid) to authenticated;
