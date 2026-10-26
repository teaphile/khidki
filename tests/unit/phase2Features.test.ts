// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decryptKeyVault,
  encryptKeyVault,
  generateConversationKey,
  generateIdentity,
  parseKeyVault,
  publicBundle,
  samePublicKey,
} from '../../src/lib/crypto';
import { isValidDpDataUrl, parseDpUrl, prepareDpImage } from '../../src/lib/dp';
import {
  clearIdentityMemoryCache,
  restoreIdentityFromVault,
  stageSignupIdentityWithVault,
} from '../../src/lib/identityStore';
import {
  MESSAGE_TTL_MS,
  packStoredFileMessage,
  packStoredTextMessage,
  resolveSeenTimers,
  unpackStoredMessage,
} from '../../src/lib/messaging';
import { usernameSchema } from '../../src/lib/validation';
import type { StoredMessageRow } from '../../src/types';

describe('Khidki: KeyVault, 1m Post-Seen Queue & Image-Only DP', () => {
  it('enforces a strict 1-minute (60,000 ms) post-seen auto-clean timer everywhere', () => {
    expect(MESSAGE_TTL_MS).toBe(60_000);
  });

  it('wraps and restores E2EE identity keys with PBKDF2-SHA256 + AES-256-GCM across multi-day logouts', async () => {
    clearIdentityMemoryCache();
    const { identity, vault } = await stageSignupIdentityWithVault(
      'ashish@gmail.com',
      'StrongPass2026',
    );
    expect(parseKeyVault(vault)).toEqual(vault);

    // Simulate signing out and returning 3 days later on a clean browser
    clearIdentityMemoryCache();
    const expectedPub = publicBundle(identity);

    const wrongAttempt = await restoreIdentityFromVault(
      'user-123',
      vault,
      'WrongPassword99',
      expectedPub,
    );
    expect(wrongAttempt).toBeNull();

    const restored = await restoreIdentityFromVault(
      'user-123',
      vault,
      'StrongPass2026',
      expectedPub,
    );
    expect(restored).not.toBeNull();
    expect(samePublicKey(publicBundle(restored!), expectedPub)).toBe(true);
  });

  it('rejects tampered key vaults', async () => {
    const id = await generateIdentity();
    const vault = await encryptKeyVault(id, 'SecretPass99');
    const tampered = { ...vault, ct: `${vault.ct.slice(0, -4)}AAAA` };
    await expect(decryptKeyVault(tampered, 'SecretPass99')).rejects.toThrow();
  });

  it('packs, verifies, and unpacks offline queued messages and starts 1m timer only after seen', async () => {
    const sender = await generateIdentity();
    const senderPub = publicBundle(sender);
    const convKey = generateConversationKey();
    const conversationId = crypto.randomUUID();
    const senderId = crypto.randomUUID();
    const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;

    const packed = await packStoredTextMessage({
      key: convKey,
      id: crypto.randomUUID(),
      conversationId,
      senderId,
      text: 'Unread across 3 days until individual chat opened',
      createdAt: threeDaysAgo,
      signPrivateKey: sender.sig.privateKey,
    });

    const unseenRow: StoredMessageRow = {
      id: packed.id,
      conversation_id: packed.conversationId,
      sender_id: senderId,
      kind: 'text',
      iv: packed.iv,
      ciphertext: packed.ciphertext,
      sig: packed.sig,
      byte_size: packed.byteSize,
      client_created_at: packed.clientCreatedAt,
      created_at: new Date(threeDaysAgo).toISOString(),
      seen_at: null,
      expires_at: null,
    };

    // Unseen after 3 days -> still decrypts and has null expiry!
    const unpacked = await unpackStoredMessage(unseenRow, convKey, senderPub);
    expect(unpacked).toEqual({
      kind: 'text',
      text: 'Unread across 3 days until individual chat opened',
    });
    expect(resolveSeenTimers(unseenRow.seen_at, unseenRow.expires_at)).toEqual({
      seenAt: null,
      expiresAt: null,
    });

    // Once seen by recipient -> expires in 1 minute (60,000 ms)
    const seenNow = new Date();
    const expInOneMin = new Date(seenNow.getTime() + MESSAGE_TTL_MS);
    const timers = resolveSeenTimers(seenNow.toISOString(), expInOneMin.toISOString());
    expect(timers.seenAt).toBe(seenNow.getTime());
    expect(timers.expiresAt).toBe(expInOneMin.getTime());
    expect(timers.expiresAt! - timers.seenAt!).toBe(60_000);

    // Tampered ciphertext is rejected
    const tamperedRow = { ...unseenRow, ciphertext: `${unseenRow.ciphertext.slice(0, -4)}BBBB` };
    expect(await unpackStoredMessage(tamperedRow, convKey, senderPub)).toBeNull();
  });

  it('packs and verifies magic bytes on stored file attachments', async () => {
    const sender = await generateIdentity();
    const senderPub = publicBundle(sender);
    const convKey = generateConversationKey();
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

    const packed = await packStoredFileMessage({
      key: convKey,
      id: crypto.randomUUID(),
      conversationId: crypto.randomUUID(),
      senderId: crypto.randomUUID(),
      name: 'snap.png',
      mime: 'image/png',
      bytes: pngBytes,
      caption: 'Look at this',
      createdAt: Date.now(),
      signPrivateKey: sender.sig.privateKey,
    });

    const row: StoredMessageRow = {
      id: packed.id,
      conversation_id: packed.conversationId,
      sender_id: crypto.randomUUID(),
      kind: 'file',
      iv: packed.iv,
      ciphertext: packed.ciphertext,
      sig: packed.sig,
      byte_size: packed.byteSize,
      client_created_at: packed.clientCreatedAt,
      created_at: new Date().toISOString(),
      seen_at: null,
      expires_at: null,
    };

    // Spoofed sender_id must fail AAD + signature verification
    expect(await unpackStoredMessage(row, convKey, senderPub)).toBeNull();
  });

  it('validates DP data URLs strictly as raster images and rejects SVGs or non-image files', async () => {
    const validWebp = `data:image/webp;base64,${'QUJD'.repeat(12)}`;
    const validJpeg = `data:image/jpeg;base64,${'QUJD'.repeat(12)}`;
    expect(isValidDpDataUrl(validWebp)).toBe(true);
    expect(isValidDpDataUrl(validJpeg)).toBe(true);
    expect(parseDpUrl(validWebp)).toBe(validWebp);

    // Block SVGs, HTML, PDFs, external URLs, and arbitrary strings
    expect(isValidDpDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isValidDpDataUrl('data:application/pdf;base64,JVBERi0xLjQK')).toBe(false);
    expect(isValidDpDataUrl('https://evil.example/avatar.png')).toBe(false);
    expect(parseDpUrl('fox')).toBeNull();

    const svgFile = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'icon.svg', {
      type: 'image/svg+xml',
    });
    const svgRes = await prepareDpImage(svgFile);
    expect(svgRes.ok).toBe(false);

    const disguisedSvg = new File(['<svg onload="alert(1)"></svg>'], 'photo.png', {
      type: 'image/png',
    });
    const disguisedRes = await prepareDpImage(disguisedSvg);
    expect(disguisedRes.ok).toBe(false);

    const pdfFile = new File(['%PDF-1.7'], 'doc.pdf', { type: 'application/pdf' });
    const pdfRes = await prepareDpImage(pdfFile);
    expect(pdfRes.ok).toBe(false);

    expect(usernameSchema.safeParse('khidki').success).toBe(false);
  });
});
