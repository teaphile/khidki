# Security Architecture

Khidki uses browser-side Web Crypto primitives paired with PostgreSQL Row Level Security (RLS) and `SECURITY DEFINER` RPCs on Supabase.

## Cryptographic Primitives

- **Identity & Signatures**: `ECDH P-256` for key wrapping and `ECDSA P-256` (`SHA-256`) for signing every message, file payload, and WebRTC call signal.
- **Conversation Encryption**: Random 256-bit `AES-GCM` keys per conversation, rotated automatically when group membership changes.
- **Cross-Session Key Vault**: Private keys are sealed with `PBKDF2-SHA256` (`210,000` iterations) + `AES-256-GCM` in `public.profile_vaults` (owner-only RLS) so signing out preserves your identity safely across sessions.

## Cloud & Auth Protections

- **Private Signup Email**: Authenticated clients receive column-level `SELECT` access only to the profile fields the app needs. The normalized signup email is explicitly excluded, while row-level policies still limit profile rows to the owner and conversation contacts.
- **Email Verification & Link Hardening**: Disposable mail domains and `+` aliases are rejected at both client and database trigger layers. Auth redirect URIs are locked to the production origin, and single-use auth codes/tokens are scrubbed immediately from the browser URL via `history.replaceState`. The short-lived password handoff between sign-in and vault unlock is removed on use, sign-out, or immediately after a failed or email-unconfirmed auth attempt; abandoned handoffs expire after 20 seconds.
- **Password Policy Alignment**: The client requires at least 10 characters with a letter and a number. Configure Supabase Auth to enforce the same minimum server-side; client validation alone can be bypassed.
- **Strict Image-Only Profile Photo**: Profile photos (`avatar_url`) are decoded as raster bitmaps, stripped of EXIF metadata on an offscreen canvas, re-encoded under `24 KB`, and checked by a PostgreSQL regex constraint blocking SVG/XML/HTML/non-image payloads.
- **Immutable One-Minute Auto-Delete**: `public.messages` blocks content edits via database trigger, caps per-user unseen attachment storage to protect Free Tier limits, never auto-marks chats seen on login, and removes read messages one minute after they are seen.
