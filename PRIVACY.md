# Privacy Policy

Khidki is built so that message contents, attachments, and calls remain end-to-end encrypted between participants.

## Summary

- **Encrypted until opened**: Unread messages wait as AES-256-GCM ciphertext while you are offline. Signing in does not mark them as read; opening that specific chat does.
- **One-minute auto-delete**: Texts, photos, images, videos, and files disappear one minute after they are read.
- **No-expiry requests**: Incoming requests remain pending until accepted or removed, and outgoing requests remain pending until accepted or cancelled. There is no request countdown. Message content still follows the normal message auto-delete and retention rules.
- **No phone number required**: Accounts use a verified personal or academic email address, a `3 to 10` character alphanumeric username, an optional image-only profile photo, and a password. Your normalized signup email is private and is not exposed to chat contacts.
- **Logout vs Delete Account**:
  - **Logging out** clears active decrypted state on your device while preserving your account, username, profile photo, and encrypted key vault in cloud storage.
  - **Deleting your account** permanently erases your `auth.users` login, profile, profile photo, key vault, wrapped conversation keys, sent messages, 1-on-1 conversations, and call signals from cloud storage and wipes local device keys.
