import type { Identity } from '../types';
import { generateIdentity } from './crypto';

const DB_NAME = 'sotto-device';
const STORE = 'identity';
const KEY = 'v1';
let memoryFallback: Identity | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open device storage'));
  });
}

function isValidIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<Identity>;
  return (
    candidate.v === 1 &&
    !!candidate.ecdh?.privateKey?.d &&
    !!candidate.ecdh?.publicKey?.x &&
    !!candidate.sig?.privateKey?.d &&
    !!candidate.sig?.publicKey?.x
  );
}

export async function loadIdentity(): Promise<Identity | null> {
  if (typeof indexedDB === 'undefined') return memoryFallback;
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
    return isValidIdentity(value) ? value : null;
  } catch {
    return memoryFallback;
  }
}

export async function saveIdentity(identity: Identity): Promise<void> {
  memoryFallback = identity;
  if (typeof indexedDB === 'undefined') return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(identity, KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOrCreateIdentity(): Promise<Identity> {
  const existing = await loadIdentity();
  if (existing) return existing;
  const identity = await generateIdentity();
  await saveIdentity(identity);
  return identity;
}
