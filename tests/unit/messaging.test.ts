// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateConversationKey, generateIdentity, publicBundle } from '../../src/lib/crypto';
import {
  base64ToBytes,
  bytesToBase64,
  clampExpiry,
  decryptChunkWire,
  decryptMessageWire,
  encryptChunkWire,
  encryptFileMetaWire,
  encryptTextWire,
  FILE_CHUNK_BYTES,
  MESSAGE_TTL_MS,
  verifyChunkWire,
  verifyMessageWire,
} from '../../src/lib/messaging';
import type { FilePlain } from '../../src/lib/messaging';

async function fixture() {
  const identity = await generateIdentity();
  return {
    identity,
    bundle: publicBundle(identity),
    key: generateConversationKey(),
    conversationId: '37b8d1d8-5f7e-4a5c-9a6c-4f8f33af0b0f',
    senderId: 'a1d0f4fa-1e0c-4f4b-9c3b-52c97b2f60f2',
  };
}

describe('messaging wire format', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips an encrypted text message', async () => {
    const f = await fixture();
    const wire = await encryptTextWire({
      key: f.key,
      id: crypto.randomUUID(),
      conversationId: f.conversationId,
      senderId: f.senderId,
      text: 'Meet me at seven.',
      createdAt: Date.now(),
      signPrivateKey: f.identity.sig.privateKey,
    });

    expect(await verifyMessageWire(wire, f.bundle)).toBe(true);
    await expect(decryptMessageWire(wire, f.key)).resolves.toEqual({
      text: 'Meet me at seven.',
    });
  });

  it('rejects a text message signed by another device', async () => {
    const f = await fixture();
    const other = publicBundle(await generateIdentity());
    const wire = await encryptTextWire({
      key: f.key,
      id: crypto.randomUUID(),
      conversationId: f.conversationId,
      senderId: f.senderId,
      text: 'Spoofed',
      createdAt: Date.now(),
      signPrivateKey: f.identity.sig.privateKey,
    });

    expect(await verifyMessageWire(wire, other)).toBe(false);
  });

  it('rejects a message whose ciphertext was altered', async () => {
    const f = await fixture();
    const wire = await encryptTextWire({
      key: f.key,
      id: crypto.randomUUID(),
      conversationId: f.conversationId,
      senderId: f.senderId,
      text: 'Original text',
      createdAt: Date.now(),
      signPrivateKey: f.identity.sig.privateKey,
    });
    const altered = { ...wire, ct: `${wire.ct.slice(0, -4)}AAAA` };

    expect(await verifyMessageWire(altered, f.bundle)).toBe(false);
    await expect(decryptMessageWire(altered, f.key)).rejects.toThrow();
  });

  it('round-trips file metadata and chunk bytes', async () => {
    const f = await fixture();
    const messageId = crypto.randomUUID();
    const createdAt = Date.now();
    const payload = new Uint8Array(FILE_CHUNK_BYTES).fill(7);
    const meta: FilePlain = {
      name: 'notes.txt',
      mime: 'text/plain',
      size: payload.byteLength,
      chunks: 1,
      chunkSize: FILE_CHUNK_BYTES,
    };

    const metaWire = await encryptFileMetaWire({
      key: f.key,
      id: messageId,
      conversationId: f.conversationId,
      senderId: f.senderId,
      file: meta,
      createdAt,
      signPrivateKey: f.identity.sig.privateKey,
    });
    const chunk = await encryptChunkWire({
      key: f.key,
      messageId,
      conversationId: f.conversationId,
      senderId: f.senderId,
      createdAt,
      index: 0,
      bytes: payload,
      signPrivateKey: f.identity.sig.privateKey,
    });

    expect(await verifyMessageWire(metaWire, f.bundle)).toBe(true);
    expect(await verifyChunkWire(chunk, f.bundle)).toBe(true);
    await expect(decryptMessageWire(metaWire, f.key)).resolves.toEqual(meta);

    const bytes = await decryptChunkWire(chunk, f.key);
    expect(bytes.byteLength).toBe(payload.byteLength);
    expect(bytes[0]).toBe(7);
  });

  it('rejects chunks with an out-of-order signature context', async () => {
    const f = await fixture();
    const messageId = crypto.randomUUID();
    const createdAt = Date.now();
    const chunk = await encryptChunkWire({
      key: f.key,
      messageId,
      conversationId: f.conversationId,
      senderId: f.senderId,
      createdAt,
      index: 0,
      bytes: new Uint8Array([1, 2, 3]),
      signPrivateKey: f.identity.sig.privateKey,
    });
    const moved = { ...chunk, index: 1 };

    expect(await verifyChunkWire(moved, f.bundle)).toBe(false);
    await expect(decryptChunkWire(moved, f.key)).rejects.toThrow();
  });

  it('clamps expiry to the 120 second window', () => {
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(clampExpiry(now)).toBe(now + MESSAGE_TTL_MS);
    expect(clampExpiry(now - MESSAGE_TTL_MS * 5)).toBe(now);
    expect(clampExpiry(now + 10 * 60_000)).toBe(now + MESSAGE_TTL_MS);

    vi.useRealTimers();
  });

  it('encodes bytes without exceeding the call stack', () => {
    const bytes = new Uint8Array(200_000).map((_, index) => index % 251);
    const encoded = bytesToBase64(bytes);

    expect(base64ToBytes(encoded).byteLength).toBe(bytes.byteLength);
    expect(base64ToBytes(encoded)[199_999]).toBe(bytes[199_999]);
  });
});
