import { z } from 'zod';
import type { Identity, Jwk, PrivateKeyMaterial, PublicKeyBundle } from '../types';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

const coordSchema = z
  .string()
  .min(40)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

const publicEcJwkSchema = z
  .object({
    kty: z.literal('EC'),
    crv: z.literal('P-256'),
    x: coordSchema,
    y: coordSchema,
  })
  .strict();

export const publicKeyBundleSchema: z.ZodType<PublicKeyBundle> = z
  .object({
    v: z.literal(1),
    ecdh: publicEcJwkSchema,
    sig: publicEcJwkSchema,
  })
  .strict();

export function parsePublicKeyBundle(value: unknown): PublicKeyBundle | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const ecdh =
    candidate.ecdh && typeof candidate.ecdh === 'object'
      ? (candidate.ecdh as Record<string, unknown>)
      : null;
  const sig =
    candidate.sig && typeof candidate.sig === 'object'
      ? (candidate.sig as Record<string, unknown>)
      : null;
  if (!ecdh || !sig || 'd' in ecdh || 'd' in sig) return null;

  const normalized = {
    v: candidate.v,
    ecdh: { kty: ecdh.kty, crv: ecdh.crv, x: ecdh.x, y: ecdh.y },
    sig: { kty: sig.kty, crv: sig.crv, x: sig.x, y: sig.y },
  };
  const parsed = publicKeyBundleSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

export const b64 = {
  encode(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  },
  decode(value: string): Bytes {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
};

export function randomBytes(length: number): Bytes {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function isCryptoKey(value: PrivateKeyMaterial): value is CryptoKey {
  return typeof CryptoKey !== 'undefined' && value instanceof CryptoKey;
}

function sanitizePublicJwk(jwk: Jwk): JsonWebKey {
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string' ||
    'd' in jwk
  ) {
    throw new Error('Invalid EC P-256 public key.');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

function sanitizePrivateJwk(jwk: Jwk): JsonWebKey {
  if (
    jwk.kty !== 'EC' ||
    jwk.crv !== 'P-256' ||
    typeof jwk.x !== 'string' ||
    typeof jwk.y !== 'string' ||
    typeof jwk.d !== 'string'
  ) {
    throw new Error('Invalid EC P-256 private key.');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d };
}

async function importEcdhPublic(jwk: Jwk): Promise<CryptoKey> {
  return subtle.importKey(
    'jwk',
    sanitizePublicJwk(jwk),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

async function resolveEcdhPrivate(key: PrivateKeyMaterial): Promise<CryptoKey> {
  if (isCryptoKey(key)) return key;
  return subtle.importKey(
    'jwk',
    sanitizePrivateJwk(key),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

async function resolveSignPrivate(key: PrivateKeyMaterial): Promise<CryptoKey> {
  if (isCryptoKey(key)) return key;
  return subtle.importKey(
    'jwk',
    sanitizePrivateJwk(key),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function importSignPublic(jwk: Jwk): Promise<CryptoKey> {
  return subtle.importKey(
    'jwk',
    sanitizePublicJwk(jwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

export async function generateIdentity(): Promise<Identity> {
  const ecdh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const sig = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const ecdhPub = (await subtle.exportKey('jwk', ecdh.publicKey)) as Jwk;
  const sigPub = (await subtle.exportKey('jwk', sig.publicKey)) as Jwk;

  return {
    v: 1,
    ecdh: {
      publicKey: { kty: 'EC', crv: 'P-256', x: ecdhPub.x, y: ecdhPub.y },
      privateKey: (await subtle.exportKey('jwk', ecdh.privateKey)) as Jwk,
    },
    sig: {
      publicKey: { kty: 'EC', crv: 'P-256', x: sigPub.x, y: sigPub.y },
      privateKey: (await subtle.exportKey('jwk', sig.privateKey)) as Jwk,
    },
  };
}

/**
 * Generates an identity whose private keys are non-extractable CryptoKeys.
 * Even scripts running on the same origin cannot export raw private scalars.
 */
export async function generateDeviceIdentity(): Promise<Identity> {
  const ecdh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const sig = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);

  const ecdhPub = (await subtle.exportKey('jwk', ecdh.publicKey)) as Jwk;
  const sigPub = (await subtle.exportKey('jwk', sig.publicKey)) as Jwk;

  return {
    v: 2,
    ecdh: {
      publicKey: { kty: 'EC', crv: 'P-256', x: ecdhPub.x, y: ecdhPub.y },
      privateKey: ecdh.privateKey,
    },
    sig: {
      publicKey: { kty: 'EC', crv: 'P-256', x: sigPub.x, y: sigPub.y },
      privateKey: sig.privateKey,
    },
  };
}

/** Upgrades a legacy JWK-backed identity into a non-extractable CryptoKey identity. */
export async function sealIdentity(identity: Identity): Promise<Identity> {
  if (
    identity.v === 2 &&
    isCryptoKey(identity.ecdh.privateKey) &&
    isCryptoKey(identity.sig.privateKey)
  ) {
    return identity;
  }
  const ecdhPrivate = await resolveEcdhPrivate(identity.ecdh.privateKey);
  const sigPrivate = await resolveSignPrivate(identity.sig.privateKey);
  return {
    v: 2,
    ecdh: {
      publicKey: {
        kty: 'EC',
        crv: 'P-256',
        x: identity.ecdh.publicKey.x,
        y: identity.ecdh.publicKey.y,
      },
      privateKey: ecdhPrivate,
    },
    sig: {
      publicKey: {
        kty: 'EC',
        crv: 'P-256',
        x: identity.sig.publicKey.x,
        y: identity.sig.publicKey.y,
      },
      privateKey: sigPrivate,
    },
  };
}

export function publicBundle(identity: Identity): PublicKeyBundle {
  return {
    v: 1,
    ecdh: {
      kty: 'EC',
      crv: 'P-256',
      x: identity.ecdh.publicKey.x,
      y: identity.ecdh.publicKey.y,
    },
    sig: {
      kty: 'EC',
      crv: 'P-256',
      x: identity.sig.publicKey.x,
      y: identity.sig.publicKey.y,
    },
  };
}

export function samePublicKey(a: PublicKeyBundle | null, b: PublicKeyBundle | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.ecdh.x === b.ecdh.x && a.ecdh.y === b.ecdh.y && a.sig.x === b.sig.x && a.sig.y === b.sig.y
  );
}

function canonicalBundleString(bundle: PublicKeyBundle): string {
  return JSON.stringify({
    ecdh: [bundle.ecdh.crv, bundle.ecdh.x, bundle.ecdh.y],
    sig: [bundle.sig.crv, bundle.sig.x, bundle.sig.y],
  });
}

function formatHexDigest(digest: Uint8Array): string {
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

export async function fingerprint(bundle: PublicKeyBundle): Promise<string> {
  const canonical = canonicalBundleString(bundle);
  const digest = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(canonical)));
  return formatHexDigest(digest);
}

/**
 * Symmetric pairwise safety number for two conversation peers. Both sides
 * compute the exact same grouped hex string unless a key was substituted.
 */
export async function safetyNumberForPair(
  first: PublicKeyBundle,
  second: PublicKeyBundle,
): Promise<string> {
  const pair = [canonicalBundleString(first), canonicalBundleString(second)].sort();
  const payload = JSON.stringify(['sotto-safety-v1', ...pair]);
  const digest = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(payload)));
  return formatHexDigest(digest);
}

/** ECDH -> HKDF-SHA256 -> raw AES-256 key (base64). */
export async function derivePairwiseKey(
  privateKey: PrivateKeyMaterial,
  publicJwk: Jwk,
  context: string,
): Promise<string> {
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: await importEcdhPublic(publicJwk) },
    await resolveEcdhPrivate(privateKey),
    256,
  );
  const ikm = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('sotto-e2e-v1'),
      info: encoder.encode(context),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  return b64.encode(new Uint8Array(await subtle.exportKey('raw', key)));
}

export function generateConversationKey(): string {
  return b64.encode(randomBytes(32));
}

export async function wrapConversationKey(
  conversationKey: string,
  fromPrivate: PrivateKeyMaterial,
  toPublic: Jwk,
  conversationId: string,
): Promise<{ wrappedKey: string; iv: string }> {
  const context = `wrap:${conversationId}`;
  const kek = await derivePairwiseKey(fromPrivate, toPublic, context);
  const key = await importAesKey(kek);
  const iv = randomBytes(12);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    key,
    b64.decode(conversationKey),
  );
  return { wrappedKey: b64.encode(new Uint8Array(ciphertext)), iv: b64.encode(iv) };
}

export async function unwrapConversationKey(
  wrappedKey: string,
  wrapIv: string,
  myPrivate: PrivateKeyMaterial,
  fromPublic: Jwk,
  conversationId: string,
): Promise<string> {
  const context = `wrap:${conversationId}`;
  const kek = await derivePairwiseKey(myPrivate, fromPublic, context);
  const key = await importAesKey(kek);
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64.decode(wrapIv), additionalData: encoder.encode(context) },
    key,
    b64.decode(wrappedKey),
  );
  return b64.encode(new Uint8Array(plaintext));
}

async function importAesKey(rawB64: string): Promise<CryptoKey> {
  return subtle.importKey('raw', b64.decode(rawB64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptBytes(
  keyB64: string,
  bytes: Bytes,
  aad: string,
): Promise<{ iv: string; ct: string }> {
  const key = await importAesKey(keyB64);
  const iv = randomBytes(12);
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    bytes,
  );
  return { iv: b64.encode(iv), ct: b64.encode(new Uint8Array(ciphertext)) };
}

export async function decryptBytes(
  keyB64: string,
  ivB64: string,
  ctB64: string,
  aad: string,
): Promise<Bytes> {
  const key = await importAesKey(keyB64);
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64.decode(ivB64), additionalData: encoder.encode(aad) },
    key,
    b64.decode(ctB64),
  );
  return new Uint8Array(plaintext);
}

export async function encryptJson(
  keyB64: string,
  value: unknown,
  aad: string,
): Promise<{ iv: string; ct: string }> {
  return encryptBytes(keyB64, encoder.encode(JSON.stringify(value)), aad);
}

export async function decryptJson<T>(
  keyB64: string,
  ivB64: string,
  ctB64: string,
  aad: string,
): Promise<T> {
  const bytes = await decryptBytes(keyB64, ivB64, ctB64, aad);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export async function signPayload(
  privateSigKey: PrivateKeyMaterial,
  payload: string,
): Promise<string> {
  const key = await resolveSignPrivate(privateSigKey);
  const signature = await subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    encoder.encode(payload),
  );
  return b64.encode(new Uint8Array(signature));
}

export async function verifyPayload(
  publicSigJwk: Jwk,
  payload: string,
  signatureB64: string,
): Promise<boolean> {
  try {
    const key = await importSignPublic(publicSigJwk);
    return await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64.decode(signatureB64),
      encoder.encode(payload),
    );
  } catch {
    return false;
  }
}
