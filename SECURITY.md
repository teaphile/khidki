# Security policy

Sotto is a small, self-hostable private messenger. This document describes what
it protects, what it does not, and how to report a problem. It is not a formal
audit or a warranty.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

- Use GitHub's **Report a vulnerability** private advisory on the repository, or
- Contact the operator of the deployment through the security contact published
  with that deployment.

Include affected version/commit, reproduction steps, impact, and any suggested
fix. Expect an initial response within a few days. Please allow time for a fix
before public disclosure, and do not test against other people's accounts or
production data.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

Only the latest commit on the default branch receives security fixes. There are
no long-term support branches.

## Threat model

### Protected against

- **Database or storage compromise.** Message text, captions, file names, and
  file bytes are never written to Postgres or Supabase Storage. A dump of the
  database exposes account and conversation metadata, not content.
- **Unauthorized database access.** Row-level security restricts profiles,
  conversations, memberships, and wrapped keys. Clients have no insert or delete
  grants on conversation tables; membership changes go through
  `SECURITY DEFINER` RPCs with membership checks.
- **Realtime eavesdropping.** Private Realtime channels authorize reads and
  writes through RLS on `realtime.messages`. Broadcast payloads are encrypted
  regardless, so a broker cannot read content.
- **Message tampering and spoofing.** Every message, file chunk, and call
  envelope is signed with ECDSA P-256 and bound to its conversation, sender,
  message/call ID, and timestamp. Receivers verify the signature against the
  sender's profile key and reject mismatched contexts.
- **Cross-conversation replay.** Encryption uses AES-GCM additional authenticated
  data containing the conversation ID, sender, and message context.
- **Malicious attachment handling.** Only JPEG, PNG, WebP, GIF, PDF, and plain
  text are accepted; the browser verifies magic bytes and UTF-8 validity. Files
  are limited to 2 MB, encrypted client-side, and served from in-memory Blob
  URLs that are revoked at expiry.
- **Phishing links.** Links open through an interstitial with `noopener`,
  `noreferrer`, and `nofollow`. Plaintext HTTP, hidden credentials, raw IP
  hosts, punycode, and suspicious subdomains are flagged or blocked.
- **Weak account creation.** Email confirmation, disposable-domain rejection,
  reserved usernames, immutable usernames, and a 10-character password policy
  are enforced. Phone auth is not used.
- **Clickjacking and script injection.** The deployment sends CSP, HSTS,
  `X-Frame-Options: DENY`, `nosniff`, and a restrictive `Permissions-Policy`.
  React renders text as text; no `dangerouslySetInnerHTML` is used and there are
  no third-party scripts, previews, or embeds.

### Not protected against

- **Metadata analysis.** Supabase can see account emails, usernames, display
  names, public keys, conversation membership, conversation titles, timestamps,
  key rotation events, and traffic volume. It cannot see message content.
- **A compromised browser or device.** Malware, a malicious extension, a shared
  unlocked device, or injected script can read keys, plaintext, and media. Private
  keys are stored as JWKs in IndexedDB on the app origin; scripts running on that
  origin can extract them.
- **A malicious or compromised server.** The app is served as JavaScript, and
  profiles host public keys. A compromised Supabase project or Vercel deployment
  could serve modified code or substitute keys. Safety numbers support manual
  key comparison, but there is no key transparency log or pinned release.
- **A malicious conversation member.** Members already possess the conversation
  key and can screenshot, copy, or re-share anything they can see. Removed
  members lose future keys, not content they already received. Any member may
  rotate the key or write to another member's call inbox, which can cause
  disruption ("denial of service") but not decrypt other members' traffic.
- **Account takeover through email.** Anyone who controls the inbox can reset the
  password, but the device identity still lives in the original browser. A new
  browser generates a new identity.
- **Traffic analysis and denial of service.** Message timing and ciphertext size
  are visible to the Realtime service. Supabase and Vercel availability are
  outside the app's control.
- **Lost or cleared browser data.** Clearing site data destroys the private keys;
  existing wrapped keys become unreadable and messages cannot be recovered.

## Cryptography

| Purpose             | Primitive                                                      |
| ------------------- | -------------------------------------------------------------- |
| Identity agreement  | ECDH P-256                                                     |
| Identity signatures | ECDSA P-256 with SHA-256                                       |
| Key derivation      | HKDF-SHA256 over the ECDH shared secret, context-bound         |
| Content encryption  | AES-256-GCM with random 96-bit IV and context-bound AAD        |
| Key wrapping        | ECDH → HKDF-SHA256 → AES-256-GCM, AAD `wrap:<conversation-id>` |
| Conversation keys   | 32 random bytes, base64-encoded                                |
| Safety number       | SHA-256 over canonical public keys, rendered as grouped hex    |

- Private keys never leave the browser. Public keys are published on the profile.
- Every member has a wrapped copy of the conversation key. The server stores the
  wrapped copy and the sender's public key, not the key itself.
- Group key rotation happens when a member is added, removed, or leaves. The
  rotation is client-initiated; the server cannot generate keys.
- Call signaling uses a pairwise key derived from both identities and the call ID.
  Signaling envelopes are signed and encrypted. WebRTC media is protected by
  DTLS-SRTP end to end; a TURN server relays encrypted packets.
- Expiry is enforced client-side from the signed `createdAt`; receivers drop
  anything older than 120 seconds. The signature prevents a sender from silently
  extending a message's life, and clocks are expected to be roughly synchronized.

The implementation lives in [`src/lib/crypto.ts`](src/lib/crypto.ts),
[`src/lib/messaging.ts`](src/lib/messaging.ts), and
[`src/lib/calls.ts`](src/lib/calls.ts). Unit tests cover key agreement, wrapping,
authentication failures, signature rejection, and TTL clamping.

## Data and authorization rules

- `profiles`: readable by the owner or by someone who shares a conversation;
  users may update only their own display name and public key. Usernames are
  immutable via trigger.
- `conversations` and `conversation_members`: readable by members only. Writes
  happen through RPCs that check membership and admin role.
- `conversation_keys`: readable only by the row owner. Writes happen through
  `set_conversation_keys`, which derives the sender identity and public key from
  the authenticated profile rather than trusting the request body, validates
  every target member, caps payload sizes, and requires a fresh key for every
  current member after rotation.
- `blocked_email_domains`: no client access; used by the signup trigger.
- `realtime.messages`: conversation topics require membership; `user:<id>` topics
  are readable by that user and writable by that user or a conversation peer.
- Account deletion removes the auth user and cascades dependent rows; group
  admin roles are transferred and direct messages are deleted first.

## Operational hardening

Before exposing a deployment to real users:

1. Keep email confirmation on and phone auth off.
2. Configure custom SMTP; never rely on the shared development mailer.
3. Set the Supabase Site URL and exact redirect URLs for the production domain.
4. Review Supabase auth rate limits and enable CAPTCHA if abuse appears.
5. Configure TURN with short-lived credentials. Do not ship long-lived TURN
   secrets to the browser if your provider supports ephemeral credentials.
6. Keep the service role key out of Vercel client variables and out of the repo.
7. Review the disposable-domain table and add domains relevant to your audience.
8. Monitor Auth and Postgres logs for trigger failures and abnormal signup rates.
9. Keep dependencies current; run `npm audit` and the test suite before deploys.
10. Serve only over HTTPS. HSTS is set by `vercel.json`; do not weaken CSP without
    understanding the consequences.

## Known security limitations

- No post-compromise security or per-message forward secrecy. Conversation keys
  are long-lived until membership changes or a client chooses to rotate.
- No multi-device key sharing. A new browser is a new identity.
- No key transparency, pinned builds, or reproducible-build verification.
- No server-side message retention means no audit trail for abuse investigations.
- Message and file delivery is best-effort while both parties are online.
- Link warnings are heuristics, not a malware scanner. Users can still open a
  convincing phishing page over HTTPS.
- The app relies on the browser's Web Crypto, IndexedDB, and WebRTC
  implementations. A compromised browser is outside the threat model.
