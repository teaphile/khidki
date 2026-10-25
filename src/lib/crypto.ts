import type { Identity, Jwk, PublicKeyBundle } from '../types';

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

type Bytes = Uint8Array<ArrayBuffer>;

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

const asJwk = (jwk: Jwk) => jwk as unknown as JsonWebKey;

async function importEcdhPublic(jwk: Jwk): Promise<CryptoKey> {
  return subtle.importKey('jwk', asJwk(jwk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

async function importEcdhPrivate(jwk: Jwk): Promise<CryptoKey> {
  return subtle.importKey('jwk', asJwk(jwk), { name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
}

async function importSignPrivate(jwk: Jwk): Promise<CryptoKey> {
  return subtle.importKey('jwk', asJwk(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
}

async function importSignPublic(jwk: Jwk): Promise<CryptoKey> {
  return subtle.importKey('jwk', asJwk(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify',
  ]);
}

export async function generateIdentity(): Promise<Identity> {
  const ecdh = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const sig = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  return {
    v: 1,
    ecdh: {
      publicKey: (await subtle.exportKey('jwk', ecdh.publicKey)) as Jwk,
      privateKey: (await subtle.exportKey('jwk', ecdh.privateKey)) as Jwk,
    },
    sig: {
      publicKey: (await subtle.exportKey('jwk', sig.publicKey)) as Jwk,
      privateKey: (await subtle.exportKey('jwk', sig.privateKey)) as Jwk,
    },
  };
}

export function publicBundle(identity: Identity): PublicKeyBundle {
  return {
    v: 1,
    ecdh: {
      kty: identity.ecdh.publicKey.kty,
      crv: identity.ecdh.publicKey.crv,
      x: identity.ecdh.publicKey.x,
      y: identity.ecdh.publicKey.y,
    },
    sig: {
      kty: identity.sig.publicKey.kty,
      crv: identity.sig.publicKey.crv,
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

export async function fingerprint(bundle: PublicKeyBundle): Promise<string> {
  const canonical = JSON.stringify({
    ecdh: [bundle.ecdh.crv, bundle.ecdh.x, bundle.ecdh.y],
    sig: [bundle.sig.crv, bundle.sig.x, bundle.sig.y],
  });
  const digest = new Uint8Array(await subtle.digest('SHA-256', encoder.encode(canonical)));
  return Array.from(digest)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

/** ECDH -> HKDF-SHA256 -> raw AES-256 key (base64). */
export async function derivePairwiseKey(
  privateJwk: Jwk,
  publicJwk: Jwk,
  context: string,
): Promise<string> {
  const bits = await subtle.deriveBits(
    { name: 'ECDH', public: await importEcdhPublic(publicJwk) },
    await importEcdhPrivate(privateJwk),
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
  fromPrivate: Jwk,
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
  myPrivate: Jwk,
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

export async function signPayload(privateSigJwk: Jwk, payload: string): Promise<string> {
  const key = await importSignPrivate(privateSigJwk);
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
