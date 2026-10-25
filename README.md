# Sotto

**Private conversations. Nothing kept.**

Sotto is a real-time private messenger that stores conversation metadata but never
stores message bodies or attachments. Messages and files are encrypted in the
browser, delivered over Supabase Realtime, and disappear two minutes after they
are sent. A new session starts with an empty conversation view by design.

- Live deployment target: Vercel (static Vite build)
- Backend: Supabase Auth, Postgres, and Realtime
- Source: GitHub
- No demo accounts, seeded chats, phone signup, or fake data

---

## What it does

- **Email-only accounts.** Supabase confirms every address; disposable domains
  are rejected in the browser and by a Postgres trigger.
- **Username discovery.** People are found by an immutable, unique username, not
  by phone number or a public directory.
- **Direct messages and groups.** One-to-one chats, groups of up to 50 people,
  admin controls, member removal, and group key rotation whenever membership
  changes.
- **One-to-one audio and video calls.** WebRTC media with end-to-end encrypted
  signaling; no group calls.
- **Encrypted attachments.** Up to 2 MB, allowlisted types, magic-byte checks,
  encrypted 128 KiB chunks, and a download window before expiry.
- **Two-minute TTL.** Exactly 120 seconds in memory. Nothing is written to
  Postgres or Supabase Storage, and Blob URLs are revoked at expiry.
- **Safer links.** An interstitial shows the real destination, blocks plaintext
  HTTP and hidden credentials, and warns about IP hosts, punycode, and suspicious
  subdomains.
- **Responsive by construction.** Rail + list + chat on desktop; a single pane
  with bottom navigation below 880 px; no horizontal overflow from 320 px to
  ultrawide screens in either theme.
- **Dark and light themes.** Warm ink/cream palette with terracotta and teal
  accents, persisted locally.

## What is stored

| Data                                            | Stored in Postgres?             |
| ----------------------------------------------- | ------------------------------- |
| Email, username, display name                   | Yes (email in Supabase Auth)    |
| Device public keys                              | Yes                             |
| Conversation title, memberships, timestamps     | Yes                             |
| Wrapped conversation keys                       | Yes                             |
| Message text, captions, attachments, file names | **No**                          |
| Private keys                                    | **No** — browser IndexedDB only |

See [SECURITY.md](SECURITY.md) for the threat model and [PRIVACY.md](PRIVACY.md)
for the data inventory.

## How messaging works

1. On first use, the browser generates an ECDH P-256 key pair for key agreement
   and an ECDSA P-256 key pair for signatures. Only public keys reach Supabase.
2. Each conversation has a random AES-256 key. It is wrapped for every member
   with a pairwise ECDH → HKDF-SHA256 → AES-256-GCM key derived from the sender's
   private key and the member's public key, bound to the conversation ID.
3. A message body is encrypted with AES-256-GCM using the conversation key, then
   signed with the sender's ECDSA key. Both fields travel in a Supabase Realtime
   broadcast. The database sees only metadata.
4. Receivers verify the signature against the sender's profile key and the
   message context (conversation, sender, message ID, timestamp) before
   decrypting.
5. Files are encrypted into chunks and broadcast the same way. The receiver
   assembles the chunks in memory and can download the file until the two-minute
   TTL expires.
6. Group membership changes trigger a fresh conversation key, wrapped for the
   remaining members. Removed members cannot decrypt later traffic.

Delivery is live-only. A recipient who is offline when a message is broadcast
does not receive it later; that is the trade-off for never persisting messages.
If the server is unavailable, nothing is queued.

## Tech stack

- React 19 + TypeScript + Vite 8
- React Router 7
- Supabase JS (Auth, Postgres, Realtime)
- Web Crypto API, IndexedDB, WebRTC
- Zod for wire and form validation
- Vitest + Testing Library for unit tests, Playwright for browser tests
- No UI framework, no analytics, no third-party scripts

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A Supabase project with email confirmation enabled
- A TURN server for reliable calls on restrictive networks (optional but
  strongly recommended in production)

## Local setup

```bash
git clone <your-repository-url> sotto
cd sotto
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key

# Optional, needed for calls behind symmetric NAT or strict firewalls.
VITE_TURN_URL=turn:turn.example.com:3478
VITE_TURN_USERNAME=...
VITE_TURN_CREDENTIAL=...
```

Apply the database migration and configure Auth before the first signup. Follow
[`supabase/README.md`](supabase/README.md).

```bash
npm run dev
```

Open `http://localhost:5173`. A fresh project intentionally has no accounts,
conversations, or messages. Create two accounts with two real inboxes, confirm
both emails, then find each other by username.

## Environment variables

| Variable                 | Required | Purpose                                                      |
| ------------------------ | -------- | ------------------------------------------------------------ |
| `VITE_SUPABASE_URL`      | Yes      | Supabase project URL, for example `https://abcd.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Yes      | Public anon key; safe in the browser, protected by RLS       |
| `VITE_TURN_URL`          | No       | TURN URL used for WebRTC calls                               |
| `VITE_TURN_USERNAME`     | No       | TURN username                                                |
| `VITE_TURN_CREDENTIAL`   | No       | TURN credential                                              |

Never add `SUPABASE_SERVICE_ROLE_KEY` to the frontend or to a `VITE_*` variable.
The service role bypasses every RLS policy.

## Scripts

| Command           | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `npm run dev`     | Vite development server on port 5173                |
| `npm run build`   | Type-check, then build `dist/`                      |
| `npm run preview` | Serve the production build on port 4173             |
| `npm test`        | Unit tests (crypto, wire format, validation, files) |
| `npm run lint`    | ESLint across the repository                        |
| `npm run format`  | Prettier write                                      |
| `npm run e2e`     | Playwright browser tests                            |

### Browser tests

The public/auth suite runs without a backend. Playwright starts a dev server
with placeholder Supabase credentials, blocks all external requests, and checks
every route across 14 viewports and both themes:

```bash
npx playwright install chromium
npm run e2e
```

Authenticated layout coverage is opt-in because it needs a real project and a
throwaway account:

```bash
VITE_SUPABASE_URL=... \
VITE_SUPABASE_ANON_KEY=... \
E2E_EMAIL=test@example.com \
E2E_PASSWORD='...' \
npm run e2e
```

That test signs in and walks the workspace at every breakpoint. Sotto binds an
account to the browser's device keys, so use a dedicated test account.

## Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel, **Add New → Project** and import the repository.
3. Vercel detects Vite. Keep the defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
4. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under
   **Settings → Environment Variables** for Production, Preview, and Development.
   Add the optional `VITE_TURN_*` variables if calls must work on restrictive
   networks.
5. Deploy.
6. In Supabase **Authentication → URL Configuration**, set:
   - Site URL: `https://your-domain.example`
   - Redirect URLs: `https://your-domain.example/` and
     `https://your-domain.example/reset-password`
   - Add `http://localhost:5173/` and `http://localhost:5173/reset-password` for
     local development.
7. Redeploy after changing environment variables. Vite inlines them at build
   time.

`vercel.json` supplies SPA rewrites, long-lived asset caching, and security
headers including CSP, HSTS, `X-Frame-Options: DENY`, and a restrictive
`Permissions-Policy`. Fonts are bundled locally so no third-party font request
is made.

## Production checklist

- [ ] Migration applied and verified in the Supabase SQL editor
- [ ] Email confirmation enabled; phone auth disabled
- [ ] Custom SMTP configured; auth email templates reviewed
- [ ] Site URL and redirect URLs point at the production domain
- [ ] Supabase rate limits reviewed for signup, sign-in, and email
- [ ] Disposable-domain list reviewed
- [ ] TURN server configured for calls
- [ ] `SECURITY.md` threat model and limitations reviewed
- [ ] Two real accounts tested end to end on desktop and mobile
- [ ] Database backup policy understood: metadata only, no messages to restore

## Known limitations

- **Live delivery only.** Offline recipients miss messages permanently.
- **Single-device identity.** The private key lives in one browser profile.
  Signing in elsewhere generates a new identity and rotates conversation keys;
  older messages are not recoverable.
- **Metadata is visible to Supabase.** The service sees who talks to whom, when,
  conversation sizes, and account data. It does not see content.
- **No key transparency.** Safety numbers let two people compare keys manually,
  but a compromised server or a malicious client bundle could substitute keys.
- **No message ratchet.** Conversation keys rotate on membership changes, not on
  every message. A stolen device key plus stored wrapped keys could decrypt
  future traffic for that member.
- **Calls need TURN in production.** The default STUN-only configuration fails
  on symmetric NAT and many corporate networks.
- **No "seen" receipts, typing indicators, message search, or history.** These
  features are intentionally absent.
- **Browser support.** Modern evergreen browsers with Web Crypto, IndexedDB,
  WebRTC, and `100dvh` support.

## Project structure

```text
src/
  components/        auth screens, workspace, dialogs, call overlay
  context/           auth, chat, calls, theme, toasts
  lib/               crypto, wire format, Supabase data access, files, links
  styles/            base, auth, workspace, chat, dialogs, calls, responsive
  types.ts
supabase/
  migrations/0001_init.sql
tests/
  unit/              Vitest
  e2e/               Playwright
```

## Troubleshooting

**"Your secure profile could not load."**
The migration is missing, the signup trigger failed, or the email is not
confirmed. Confirm the address, apply `0001_init.sql`, then reload.

**"Database error saving new user."**
The username is taken or reserved, the email domain is blocked, or the auth
trigger is not installed. Check the Supabase Auth logs.

**Realtime connects but messages never arrive.**
Confirm the `realtime.messages` policies exist, private channels are enabled, and
the project is not paused. Both members must have a key row for the conversation.

**Call audio works one way or not at all.**
Configure TURN. STUN alone cannot traverse symmetric NAT.

**A new device cannot read an existing conversation.**
Expected. The identity is new, so the old wrapped key is unusable. Opening the
conversation provisions a fresh key for current members; messages sent before
that point are not recoverable.

## License

MIT. See [LICENSE](LICENSE).
