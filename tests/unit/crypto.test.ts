// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  b64,
  decryptJson,
  derivePairwiseKey,
  encryptJson,
  fingerprint,
  generateConversationKey,
  generateDeviceIdentity,
  generateIdentity,
  parsePublicKeyBundle,
  publicBundle,
  safetyNumberForPair,
  samePublicKey,
  sealIdentity,
  signPayload,
  unwrapConversationKey,
  verifyPayload,
  wrapConversationKey,
} from '../../src/lib/crypto';

describe('crypto', () => {
  it('derives the same pairwise key on both sides', async () => {
    const alice = await generateIdentity();
    const bob = await generateIdentity();

    const fromAlice = await derivePairwiseKey(
      alice.ecdh.privateKey,
      publicBundle(bob).ecdh,
      'sotto-test',
    );
    const fromBob = await derivePairwiseKey(
      bob.ecdh.privateKey,
      publicBundle(alice).ecdh,
      'sotto-test',
    );

    expect(fromAlice).toBe(fromBob);
    expect(b64.decode(fromAlice)).toHaveLength(32);
  });

  it('generates non-extractable device keys that interoperate with JWK keys', async () => {
    const alice = await generateDeviceIdentity();
    const bob = await generateIdentity();

    expect(alice.v).toBe(2);
    await expect(
      crypto.subtle.exportKey('jwk', alice.ecdh.privateKey as CryptoKey),
    ).rejects.toThrow();
    await expect(
      crypto.subtle.exportKey('jwk', alice.sig.privateKey as CryptoKey),
    ).rejects.toThrow();

    const conversationKey = generateConversationKey();
    const wrapped = await wrapConversationKey(
      conversationKey,
      alice.ecdh.privateKey,
      publicBundle(bob).ecdh,
      'conv-sealed',
    );
    const unwrapped = await unwrapConversationKey(
      wrapped.wrappedKey,
      wrapped.iv,
      bob.ecdh.privateKey,
      publicBundle(alice).ecdh,
      'conv-sealed',
    );
    expect(unwrapped).toBe(conversationKey);

    const sig = await signPayload(alice.sig.privateKey, 'sealed-message');
    await expect(verifyPayload(publicBundle(alice).sig, 'sealed-message', sig)).resolves.toBe(true);
  });

  it('seals legacy JWK identities into non-extractable keys', async () => {
    const legacy = await generateIdentity();
    const sealed = await sealIdentity(legacy);

    expect(sealed.v).toBe(2);
    expect(samePublicKey(publicBundle(legacy), publicBundle(sealed))).toBe(true);
    await expect(
      crypto.subtle.exportKey('jwk', sealed.ecdh.privateKey as CryptoKey),
    ).rejects.toThrow();
  });

  it('validates public key bundles strictly and rejects private scalars', async () => {
    const identity = await generateIdentity();
    const valid = publicBundle(identity);

    expect(parsePublicKeyBundle(valid)).toEqual(valid);
    expect(
      parsePublicKeyBundle({
        ...valid,
        ecdh: { ...valid.ecdh, d: 'leaked-private-scalar' },
      }),
    ).toBeNull();
    expect(
      parsePublicKeyBundle({
        ...valid,
        ecdh: { ...valid.ecdh, crv: 'P-384' },
      }),
    ).toBeNull();
    expect(parsePublicKeyBundle(null)).toBeNull();
  });

  it('wraps and unwraps a conversation key', async () => {
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    const conversationKey = generateConversationKey();

    const wrapped = await wrapConversationKey(
      conversationKey,
      alice.ecdh.privateKey,
      publicBundle(bob).ecdh,
      'conversation-id',
    );

    const unwrapped = await unwrapConversationKey(
      wrapped.wrappedKey,
      wrapped.iv,
      bob.ecdh.privateKey,
      publicBundle(alice).ecdh,
      'conversation-id',
    );

    expect(unwrapped).toBe(conversationKey);
  });

  it('rejects a wrapped key opened with the wrong context', async () => {
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    const wrapped = await wrapConversationKey(
      generateConversationKey(),
      alice.ecdh.privateKey,
      publicBundle(bob).ecdh,
      'conversation-a',
    );

    await expect(
      unwrapConversationKey(
        wrapped.wrappedKey,
        wrapped.iv,
        bob.ecdh.privateKey,
        publicBundle(alice).ecdh,
        'conversation-b',
      ),
    ).rejects.toThrow();
  });

  it('encrypts JSON with authenticated context', async () => {
    const key = generateConversationKey();
    const { iv, ct } = await encryptJson(key, { text: 'hello' }, 'aad-one');

    await expect(decryptJson(key, iv, ct, 'aad-one')).resolves.toEqual({ text: 'hello' });
    await expect(decryptJson(key, iv, ct, 'aad-two')).rejects.toThrow();
  });

  it('signs and verifies payloads, and rejects tampering', async () => {
    const identity = await generateIdentity();
    const bundle = publicBundle(identity);
    const signature = await signPayload(identity.sig.privateKey, 'payload');

    await expect(verifyPayload(bundle.sig, 'payload', signature)).resolves.toBe(true);
    await expect(verifyPayload(bundle.sig, 'payload-2', signature)).resolves.toBe(false);
    await expect(
      verifyPayload(bundle.sig, 'payload', `${signature.slice(0, -4)}AAAA`),
    ).resolves.toBe(false);
  });

  it('produces a stable grouped fingerprint and symmetric pairwise safety number', async () => {
    const alice = publicBundle(await generateIdentity());
    const bob = publicBundle(await generateIdentity());
    const mallory = publicBundle(await generateIdentity());
    const first = await fingerprint(alice);

    expect(first).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){7}$/);
    expect(await fingerprint(alice)).toBe(first);
    expect(await fingerprint(bob)).not.toBe(first);

    const aliceSees = await safetyNumberForPair(alice, bob);
    const bobSees = await safetyNumberForPair(bob, alice);
    const mitmSees = await safetyNumberForPair(alice, mallory);

    expect(aliceSees).toMatch(/^[0-9a-f]{4}( [0-9a-f]{4}){7}$/);
    expect(aliceSees).toBe(bobSees);
    expect(aliceSees).not.toBe(mitmSees);
  });

  it('detects key changes between devices', async () => {
    const first = publicBundle(await generateIdentity());
    const second = publicBundle(await generateIdentity());

    expect(samePublicKey(first, first)).toBe(true);
    expect(samePublicKey(first, second)).toBe(false);
    expect(samePublicKey(null, null)).toBe(true);
    expect(samePublicKey(first, null)).toBe(false);
  });
});
