# Supabase setup

Sotto needs a Supabase project for authentication, Postgres metadata, and
Realtime broadcasts. This guide takes a new project from empty to a working
deployment. There is no seed data to run: accounts are created through the app.

You need:

- A Supabase account and a new project (free tier is enough to evaluate)
- The project URL and **anon** public key
- The repository checked out locally
- Access to the SQL editor (or the Supabase CLI)

> Use a dedicated project for Sotto. The migration creates triggers on
> `auth.users` and policies on `realtime.messages`, which affect the whole
> project.

## 1. Create the project

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and create a
   project.
2. Choose a region close to your users and save the database password securely.
3. Wait for provisioning to finish.
4. Go to **Project Settings → API** and copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public** key → `VITE_SUPABASE_ANON_KEY`

Never copy the `service_role` key into the frontend. It bypasses RLS.

## 2. Apply the migration

### Option A — SQL editor (recommended for a first setup)

1. Open **SQL Editor → New query**.
2. Paste the entire contents of
   [`migrations/0001_init.sql`](migrations/0001_init.sql).
3. Run it once. It creates the schema, triggers, RPCs, grants, and realtime
   policies.
4. Check for errors. A failure on the `auth.users` trigger usually means the
   script was run with insufficient privileges; run it as the project owner in
   the dashboard SQL editor.

The script is written to be safe to re-run. It uses `if not exists`,
`create or replace`, and drops policies before recreating them. Test in staging
before re-running against production.

### Option B — Supabase CLI

```bash
npm install --global supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

If the project already has an unrelated migration history, use the SQL editor
instead or reconcile the history first.

### Verify the migration

Run these in the SQL editor:

```sql
-- Expected: profiles, conversations, conversation_members, conversation_keys,
-- blocked_email_domains
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;

-- Expected: policies for profiles, conversations, members, keys, and
-- realtime.messages
select schemaname, tablename, policyname
from pg_policies
where schemaname in ('public', 'realtime')
order by schemaname, tablename, policyname;

-- Expected: five rows (or more if you add domains)
select count(*) from public.blocked_email_domains;

-- Expected: the trigger functions exist
select proname
from pg_proc
where proname in (
  'handle_new_user',
  'enforce_email_policy',
  'set_conversation_keys',
  'delete_account'
);
```

## 3. Configure authentication

Go to **Authentication → Providers → Email**:

- Enable **Email**.
- Enable **Confirm email**. Every account must verify its inbox before it can
  sign in or be discovered.
- Disable **Phone** and every other provider you do not use.
- Set the minimum password length to **10**.
- Enable leaked-password protection if your plan provides it.
- Keep email change confirmation on.

Sotto enforces a 10-character minimum with at least one letter and one number in
the client, and its database trigger rejects disposable domains and malformed
emails. Supabase's settings are a second layer.

### URL configuration

Go to **Authentication → URL Configuration**:

- **Site URL:** `https://your-production-domain`
- **Redirect URLs:**
  - `https://your-production-domain/`
  - `https://your-production-domain/reset-password`
  - `http://localhost:5173/`
  - `http://localhost:5173/reset-password`
  - any Vercel preview URL you actually use

Without exact redirect entries, confirmation and reset emails fail or land on
the wrong page. Vercel preview domains change per deployment; add a wildcard for
your preview scope only if you understand the risk.

### SMTP

The built-in mailer is rate-limited and intended for testing. For production:

1. Open **Authentication → Emails → SMTP Settings**.
2. Enter the host, port, username, password, and sender address from your email
   provider (Resend, Amazon SES, Postmark, Mailgun, etc.).
3. Send a test email.
4. Review **Authentication → Rate Limits** for signup, sign-in, email, and token
   refresh. Tighten them for a small private service.
5. Review the confirmation and recovery templates. Keep `{{ .ConfirmationURL }}`
   or the equivalent recovery link intact.

Without working SMTP, users cannot confirm their accounts and will see "Your
secure profile could not load" after an unconfirmed signup.

## 4. Enable Realtime

Sotto uses **Broadcast** with private channels:

- `conversation:<conversation-id>` for messages, files, and key rotation events
- `user:<user-id>` for call signaling and conversation nudges

The migration creates RLS policies on `realtime.messages` that authorize these
topics. Requirements:

- Realtime must be enabled for the project (it is by default).
- Private channel authorization must use RLS. Do not disable RLS on
  `realtime.messages`.
- Do not add public policies for `conversation:%` or `user:%`.
- Presence is not used.

Test with two signed-in browsers. If the channel never joins, check
**Realtime → Inspector** in the dashboard and the browser console for
`CHANNEL_ERROR` or authorization failures.

Broadcast payloads are encrypted before they reach Realtime. Chunked files stay
within Realtime's payload limits (128 KiB plaintext per chunk, base64-encoded).

## 5. Disposable email domains

The table is populated with common temporary-mail domains. Add more without a
deployment:

```sql
insert into public.blocked_email_domains (domain, reason)
values ('example-temp-mail.com', 'disposable')
on conflict (domain) do nothing;
```

Matching is exact or suffix-based, so blocking `mailinator.com` also blocks
`inbox.mailinator.com`. The trigger applies to **new signups only**; existing
accounts are not removed if you add their domain later. Mirror additions in
`DISPOSABLE_DOMAINS` in `src/lib/validation.ts` so users get an immediate client
error instead of a server error.

## 6. Reserved usernames

Reserved names are enforced in two places:

- `RESERVED_USERNAMES` in `src/lib/validation.ts`
- The arrays inside `handle_new_user()` and `is_username_available()` in the
  migration

If you change one list, change all three and redeploy. Usernames are lowercase,
3–24 characters, use `[a-z0-9_]`, and are immutable after signup.

## 7. Create real test accounts

Do **not** insert profiles by hand. The signup trigger requires a matching
`auth.users` row, a confirmed email, and a valid device public key.

1. Open the deployed app (or `http://localhost:5173`).
2. Sign up with a real inbox you control.
3. Open the confirmation email and follow the link.
4. Sign in.
5. Repeat in a second browser profile with a second inbox.
6. Search for the first username from the second account, send a direct message,
   and verify it disappears after two minutes.
7. Create a group, add the other account, and send a file.
8. Start an audio or video call. Both browsers need microphone/camera permission.

A brand-new project correctly shows no chats and no people until accounts exist.

## 8. Key provisioning and rotation

- The first sender in a conversation generates a random conversation key and
  writes one wrapped copy per member through `set_conversation_keys`.
- A recipient with a missing or undecryptable row provisions/rotates when they
  open the conversation or receive a message they cannot decrypt.
- Adding, removing, or leaving a group rotates the key for the remaining members.
- The RPC resolves `from_user` and `from_public_key` from the caller's profile.
  It does not trust the request body, and it rejects targets who are not members.
- The server never sees an unwrapped conversation key.

If a member's profile has no public key (for example, an aborted signup), they
cannot be given a key and cannot participate. Clean up incomplete accounts:

```sql
select u.id, u.email, u.email_confirmed_at, p.username
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
   or u.email_confirmed_at is null;
```

Delete abandoned unconfirmed users from **Authentication → Users** after
checking they are not real.

## 9. Account deletion

Settings → **Delete account** calls the `delete_account()` RPC. It:

1. Transfers group admin roles to the earliest remaining member.
2. Deletes direct messages involving the account.
3. Deletes the `auth.users` row, cascading to the profile, memberships, and
   wrapped keys.

Deleted accounts cannot be restored, and their device keys are removed from the
browser after sign-out. Message content was never stored, so there is nothing
else to erase.

## 10. Backups and maintenance

- Supabase backups contain account and conversation metadata, wrapped keys, and
  logs — never messages or files. Restoring a backup restores metadata only.
- Rotating the anon key requires a frontend redeploy with the new value.
- Rotating the service role key has no effect on the frontend, but keep it secret.
- Review the disposable-domain list and Supabase auth logs periodically.
- Pause or delete unused projects; a paused project cannot serve Realtime.

## Troubleshooting

**Signup returns "Database error saving new user."**
Check the Postgres logs. Common causes: the username is already taken, the domain
is blocked, the username is reserved, the public key is missing, or the
`handle_new_user` trigger was not created. The client shows a generic message to
avoid account enumeration.

**Sign-in says "Email not confirmed."**
Email confirmation is on but the user has not clicked the link. Check SMTP
delivery and the Auth logs; use "Resend confirmation email" on the sign-in
screen.

**"Your secure profile could not load."**
The auth user exists but the profile row does not. The signup trigger failed or
the migration is missing. Confirm the email and inspect:

```sql
select u.id, u.email, u.email_confirmed_at, p.username, p.public_key
from auth.users u
left join public.profiles p on p.id = u.id
order by u.created_at desc
limit 20;
```

**Realtime times out or channels fail.**
Verify the policies exist, Realtime is enabled, the project is not paused, and
the browser is not blocking WebSockets. The client retries on refresh.

**Messages arrive but cannot be decrypted.**
The key row is missing, stale, or was written for a different device public key.
Open the conversation to trigger rotation, or check:

```sql
select m.conversation_id, m.user_id, k.updated_at, k.from_user
from public.conversation_members m
left join public.conversation_keys k
  on k.conversation_id = m.conversation_id
 and k.user_id = m.user_id
where k.user_id is null;
```

**Calls connect but there is no audio/video.**
Configure TURN. STUN alone fails on symmetric NAT. Also confirm the browser has
camera/microphone permission and that `Permissions-Policy` allows `self`.

**"That username is already taken" for a name you cannot find.**
Usernames are unique across confirmed and unconfirmed accounts. Delete abandoned
unconfirmed users or choose another name.

**RLS errors on every query.**
The caller is not authenticated, the grants were not applied, or the migration
partially failed. Re-run the migration as the project owner, then inspect
`pg_policies`.

## Security checklist

- [ ] Anon key only in the frontend; service role never exposed
- [ ] Email confirmation on, phone auth off
- [ ] Minimum password length 10 and leaked-password protection enabled
- [ ] Custom SMTP tested
- [ ] Exact Site URL and redirect URLs configured
- [ ] Realtime private-channel policies present
- [ ] Disposable-domain list reviewed
- [ ] Rate limits tightened
- [ ] Backups configured and their metadata-only nature understood
- [ ] A second account can search, message, transfer a file, and call
- [ ] Messages disappear after two minutes in both browsers

For the application's security model, see [`../SECURITY.md`](../SECURITY.md).
