# Khidki

Khidki is a private end-to-end encrypted messenger for 1-on-1 chats, groups, media sharing, and voice or video calls.

Messages wait safely in an encrypted queue while your contact is offline, stay untouched until you open that specific person’s chat, and clear automatically **1 minute after being seen**.

## Key Features

- **Zero Auto-Opened Chats on Login**: Signing in never auto-opens any conversation, even if 10 or more people messaged you while offline. Each chat’s 1-minute post-seen countdown starts only when you open that individual conversation.
- **1-Minute Auto-Clean Across Everything**: Text messages, photos, images, videos, and files all clear automatically 1 minute (`60s`) after being seen. No message editing or manual tampering is permitted.
- **End-to-End Browser Encryption**:
  - `ECDH P-256` + `HKDF-SHA256` key agreement
  - `AES-256-GCM` authenticated message & attachment encryption
  - `ECDSA P-256` sender authentication signatures
  - `PBKDF2-SHA256` (`210,000` iterations) + `AES-256-GCM` owner-isolated cloud key vault so logging out and signing back in preserves your keys safely
- **Optional Image-Only DP**: Simple Display Picture (`DP`) support that accepts any valid raster image format, strips EXIF metadata, compresses to a lightweight square thumbnail (`<= 24 KB`), and strictly blocks non-image or SVG payloads.
- **Verified Accounts & Anti-Spam**: Blocks disposable/temporary mail domains, enforces email confirmation before sign-in, restricts usernames to `3 to 10` lowercase alphanumeric characters (`a-z`, `0-9`), and routes first-time contacts into **Message Requests**.
- **Logout vs Delete Account**:
  - **Log out** signs out locally on the current device while keeping your username, DP, and encrypted key vault safe in Supabase cloud.
  - **Delete account** performs complete zero-to-whole deletion across Supabase Auth, profiles, DP, vaults, keys, messages, call signals, and device IndexedDB.
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
