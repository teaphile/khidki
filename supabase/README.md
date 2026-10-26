# Supabase Setup for Khidki

Khidki uses Supabase for verified email authentication, PostgreSQL metadata with Row Level Security, and Realtime encrypted broadcast channels.

## Applying Migrations

Apply the SQL migrations in `supabase/migrations/` in order:

1. `0001_init.sql`
2. `0002_phase2_upgrade.sql`
3. `0003_khidki_upgrade.sql`

## Required Auth Configuration

- Enable Email provider with **Confirm email** turned ON (`mailer_autoconfirm = false`).
- Set **Site URL** to your production domain (for example `https://khidkiapp.vercel.app`) and restrict **Redirect URLs** to that origin (`https://khidkiapp.vercel.app/**`).
- Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` and Vercel project environment variables. Never expose the `service_role` secret key in client code.
