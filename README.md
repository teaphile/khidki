# Khidki

**Live App:** [https://khidkiapp.vercel.app](https://khidkiapp.vercel.app)

Khidki is a private end-to-end encrypted messenger for 1-on-1 chats, groups, media sharing, and voice or video calls.

Messages wait safely in an encrypted queue while your contact is offline, stay closed until you open that specific person’s chat, and disappear automatically **1 minute after being read**.

## Key Features

- **Zero Auto-Opened Chats on Login**: Signing in never opens a conversation or marks its messages as read. The one-minute auto-delete window starts only after you open that specific chat.
- **One-Minute Auto-Delete**: Text messages, photos, images, videos, and files disappear one minute after they are read. Messages cannot be edited after sending.
- **Requests Stay Pending**: Incoming requests remain pending until you accept or remove them; outgoing requests can be cancelled. Requests have no expiry countdown.
- **Chat Preferences**: Choose light, dark, or system appearance and decide whether Enter sends a message. The keyboard preference stays local to your browser.
- **End-to-End Browser Encryption**:
  - `ECDH P-256` + `HKDF-SHA256` key agreement
  - `AES-256-GCM` authenticated message and attachment encryption
  - `ECDSA P-256` sender authentication signatures
  - `PBKDF2-SHA256` (`210,000` iterations) + `AES-256-GCM` owner-isolated cloud key vault so logging out and signing back in preserves your keys safely
- **Optional Image-Only Profile Photo**: Accepts any valid raster image format, strips EXIF metadata, compresses to a lightweight square thumbnail (`<= 24 KB`), and blocks non-image or SVG payloads.
- **Verified Accounts & Anti-Spam**: Blocks disposable or temporary mail domains, enforces email confirmation before sign-in, restricts usernames to `3 to 10` lowercase alphanumeric characters (`a-z`, `0-9`), and routes first-time contacts into **Message Requests**.
- **Logout vs Delete Account**:
  - **Log out** signs out locally on the current device while keeping your username, profile photo, and encrypted key vault safe in Supabase cloud.
  - **Delete account** performs complete zero-to-whole deletion across Supabase Auth, profiles, profile photos, vaults, keys, messages, call signals, and device IndexedDB.
- **Voice & Video Calling**: Peer-to-peer WebRTC audio and video calls with signed E2EE signaling and mobile camera switching.

## Local Development

```bash
npm install
cp .env.example .env.local
# Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local
npm run dev
```

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
