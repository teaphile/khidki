import type { Identity, PrivateKeyMaterial, PublicKeyBundle } from '../types';
import {
  generateDeviceIdentity,
  generateIdentity,
  publicBundle,
  samePublicKey,
  sealIdentity,
} from './crypto';

const DB_NAME = 'sotto-device';
const STORE = 'identity';
const LEGACY_KEY = 'v1';
const PENDING_PREFIX = 'pending:';
const USER_PREFIX = 'v2:';

const memoryStore = new Map<string, Identity>();

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open device storage'));
  });
}

function isValidPrivateMaterial(value: unknown): value is PrivateKeyMaterial {
  if (typeof CryptoKey !== 'undefined' && value instanceof CryptoKey) {
    return value.type === 'private';
  }
  if (!value || typeof value !== 'object') return false;
  const jwk = value as Record<string, unknown>;
  return typeof jwk.d === 'string' && typeof jwk.x === 'string' && typeof jwk.y === 'string';
}

function isValidIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Identity>;
  return (
    (candidate.v === 1 || candidate.v === 2) &&
    !!candidate.ecdh?.publicKey?.x &&
    !!candidate.ecdh?.publicKey?.y &&
    isValidPrivateMaterial(candidate.ecdh?.privateKey) &&
    !!candidate.sig?.publicKey?.x &&
    !!candidate.sig?.publicKey?.y &&
    isValidPrivateMaterial(candidate.sig?.privateKey)
  );
}

async function readSlot(slot: string): Promise<Identity | null> {
  if (typeof indexedDB === 'undefined') {
    return memoryStore.get(slot) ?? null;
  }
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(slot);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
    return isValidIdentity(value) ? value : (memoryStore.get(slot) ?? null);
  } catch {
    return memoryStore.get(slot) ?? null;
  }
}

async function writeSlot(slot: string, identity: Identity): Promise<void> {
  memoryStore.set(slot, identity);
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(identity, slot);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Some non-browser environments cannot structured-clone CryptoKey; keep in memory.
  }
}

async function deleteSlot(slot: string): Promise<void> {
  memoryStore.delete(slot);
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(slot);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    // Ignore storage cleanup errors in restricted contexts.
  }
}

async function createBestIdentity(): Promise<Identity> {
  try {
    const sealed = await generateDeviceIdentity();
    if (typeof indexedDB !== 'undefined') {
      const probeSlot = '__probe__';
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(sealed, probeSlot);
        tx.objectStore(STORE).delete(probeSlot);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      });
    }
    return sealed;
  } catch {
    return generateIdentity();
  }
}

function normalizeEmailSlot(email: string): string {
  return `${PENDING_PREFIX}${email.trim().toLowerCase()}`;
}

/**
 * Creates a fresh identity for a new account signup and stages it under the
 * email until the account ID is known or confirmed.
 */
export async function stageSignupIdentity(email: string): Promise<Identity> {
  const identity = await createBestIdentity();
  await writeSlot(normalizeEmailSlot(email), identity);
  return identity;
}

/**
 * Binds a staged signup identity directly to the newly created user ID so no
 * other account on the same browser can ever inherit those keys.
 */
export async function commitSignupIdentity(
  userId: string,
  email: string,
  identity: Identity,
): Promise<void> {
  const sealed = await sealIdentity(identity).catch(() => identity);
  await writeSlot(`${USER_PREFIX}${userId}`, sealed);
  await deleteSlot(normalizeEmailSlot(email));
}

export async function loadIdentity(userId?: string): Promise<Identity | null> {
  if (userId) {
    return readSlot(`${USER_PREFIX}${userId}`);
  }
  return readSlot(LEGACY_KEY);
}

export async function saveIdentity(identity: Identity, userId?: string): Promise<void> {
  const slot = userId ? `${USER_PREFIX}${userId}` : LEGACY_KEY;
  await writeSlot(slot, identity);
}

/**
 * Loads or provisions an isolated cryptographic identity for `userId`.
 * Migrates a pending signup slot or legacy v1 slot ONLY when its public key
 * matches `expectedPublicKey`, preventing cross-account key sharing.
 */
export async function getOrCreateIdentity(
  userId?: string,
  expectedPublicKey?: PublicKeyBundle | null,
  email?: string | null,
): Promise<Identity> {
  if (!userId) {
    const existing = await readSlot(LEGACY_KEY);
    if (existing) return existing;
    const created = await createBestIdentity();
    await writeSlot(LEGACY_KEY, created);
    return created;
  }

  const userSlot = `${USER_PREFIX}${userId}`;
  const existing = await readSlot(userSlot);
  if (existing) {
    if (existing.v === 1) {
      const upgraded = await sealIdentity(existing).catch(() => existing);
      await writeSlot(userSlot, upgraded);
      return upgraded;
    }
    return existing;
  }

  if (email) {
    const pendingSlot = normalizeEmailSlot(email);
    const pending = await readSlot(pendingSlot);
    if (
      pending &&
      (!expectedPublicKey || samePublicKey(publicBundle(pending), expectedPublicKey))
    ) {
      const upgraded = await sealIdentity(pending).catch(() => pending);
      await writeSlot(userSlot, upgraded);
      await deleteSlot(pendingSlot);
      return upgraded;
    }
  }

  if (expectedPublicKey) {
    const legacy = await readSlot(LEGACY_KEY);
    if (legacy && samePublicKey(publicBundle(legacy), expectedPublicKey)) {
      const upgraded = await sealIdentity(legacy).catch(() => legacy);
      await writeSlot(userSlot, upgraded);
      await deleteSlot(LEGACY_KEY);
      return upgraded;
    }
  }

  const fresh = await createBestIdentity();
  await writeSlot(userSlot, fresh);
  return fresh;
}

export async function clearIdentity(userId?: string, email?: string | null): Promise<void> {
  if (userId) {
    await deleteSlot(`${USER_PREFIX}${userId}`);
  } else {
    memoryStore.clear();
  }
  if (email) {
    await deleteSlot(normalizeEmailSlot(email));
  }
  await deleteSlot(LEGACY_KEY);
}

export function clearIdentityMemoryCache(): void {
  memoryStore.clear();
}
