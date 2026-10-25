import { z } from 'zod';
import type { PublicKeyBundle } from '../types';
import {
  decryptBytes,
  decryptJson,
  encryptBytes,
  encryptJson,
  signPayload,
  verifyPayload,
} from './crypto';
import { isAllowedMime, MAX_FILE_BYTES } from './files';

export const MESSAGE_TTL_MS = 120_000;
export const FILE_CHUNK_BYTES = 128 * 1024;

const MAX_CIPHERTEXT = 420_000;
const MAX_TEXT_CIPHERTEXT = 20_000;

const uuid = z.string().uuid();
const base64 = (max: number) => z.string().min(1).max(max);

export const messagePayloadSchema = z.object({
  id: uuid,
  conversationId: uuid,
  senderId: uuid,
  kind: z.enum(['text', 'file']),
  createdAt: z.number().int().positive(),
  iv: base64(64),
  ct: base64(MAX_TEXT_CIPHERTEXT),
  sig: base64(256),
});

export type MessageWire = z.infer<typeof messagePayloadSchema>;

export const chunkPayloadSchema = z.object({
  v: z.literal(1),
  messageId: uuid,
  conversationId: uuid,
  senderId: uuid,
  createdAt: z.number().int().positive(),
  index: z.number().int().min(0).max(15),
  iv: base64(64),
  ct: base64(MAX_CIPHERTEXT),
  sig: base64(256),
});

export type ChunkWire = z.infer<typeof chunkPayloadSchema>;

const textPlainSchema = z.object({
  text: z.string().min(1).max(4000),
});

const filePlainSchema = z.object({
  name: z.string().min(1).max(96),
  mime: z.string().max(80).refine(isAllowedMime, 'Unsupported file type.'),
  size: z.number().int().positive().max(MAX_FILE_BYTES),
  chunks: z.number().int().min(1).max(16),
  chunkSize: z.number().int().positive().max(FILE_CHUNK_BYTES),
  caption: z.string().max(4000).optional(),
});

export type FilePlain = z.infer<typeof filePlainSchema>;

export function canonicalMessage(wire: Omit<MessageWire, 'sig' | 'v'> & { v?: 1 }): string {
  return JSON.stringify([
    'sotto-message-v1',
    wire.id,
    wire.conversationId,
    wire.senderId,
    wire.kind,
    wire.createdAt,
    wire.iv,
    wire.ct,
  ]);
}

export function messageAad(
  conversationId: string,
  messageId: string,
  senderId: string,
  createdAt: number,
): string {
  return `message:${conversationId}:${messageId}:${senderId}:${createdAt}`;
}

export function chunkAad(
  conversationId: string,
  messageId: string,
  senderId: string,
  index: number,
  createdAt: number,
): string {
  return `chunk:${conversationId}:${messageId}:${senderId}:${index}:${createdAt}`;
}

export function canonicalChunk(wire: Omit<ChunkWire, 'sig'>): string {
  return JSON.stringify([
    'sotto-chunk-v1',
    wire.messageId,
    wire.conversationId,
    wire.senderId,
    wire.createdAt,
    wire.index,
    wire.iv,
    wire.ct,
  ]);
}

export async function encryptTextWire(input: {
  key: string;
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: number;
  signPrivateKey: PublicKeyBundle['sig'];
}): Promise<MessageWire> {
  const plaintext = textPlainSchema.parse({ text: input.text });
  const aad = messageAad(input.conversationId, input.id, input.senderId, input.createdAt);
  const { iv, ct } = await encryptJson(input.key, plaintext, aad);
  const signature = await signPayload(
    input.signPrivateKey,
    canonicalMessage({
      id: input.id,
      conversationId: input.conversationId,
      senderId: input.senderId,
      kind: 'text',
      createdAt: input.createdAt,
      iv,
      ct,
    }),
  );
  return {
    id: input.id,
    conversationId: input.conversationId,
    senderId: input.senderId,
    kind: 'text',
    createdAt: input.createdAt,
    iv,
    ct,
    sig: signature,
  };
}

export async function encryptFileMetaWire(input: {
  key: string;
  id: string;
  conversationId: string;
  senderId: string;
  file: FilePlain;
  createdAt: number;
  signPrivateKey: PublicKeyBundle['sig'];
}): Promise<MessageWire> {
  const plaintext = filePlainSchema.parse(input.file);
  const aad = messageAad(input.conversationId, input.id, input.senderId, input.createdAt);
  const { iv, ct } = await encryptJson(input.key, plaintext, aad);
  const signature = await signPayload(
    input.signPrivateKey,
    canonicalMessage({
      id: input.id,
      conversationId: input.conversationId,
      senderId: input.senderId,
      kind: 'file',
      createdAt: input.createdAt,
      iv,
      ct,
    }),
  );
  return {
    id: input.id,
    conversationId: input.conversationId,
    senderId: input.senderId,
    kind: 'file',
    createdAt: input.createdAt,
    iv,
    ct,
    sig: signature,
  };
}

export async function encryptChunkWire(input: {
  key: string;
  messageId: string;
  conversationId: string;
  senderId: string;
  createdAt: number;
  index: number;
  bytes: Uint8Array<ArrayBuffer>;
  signPrivateKey: PublicKeyBundle['sig'];
}): Promise<ChunkWire> {
  const aad = chunkAad(
    input.conversationId,
    input.messageId,
    input.senderId,
    input.index,
    input.createdAt,
  );
  const { iv, ct } = await encryptBytes(input.key, input.bytes, aad);
  const wire = {
    v: 1 as const,
    messageId: input.messageId,
    conversationId: input.conversationId,
    senderId: input.senderId,
    createdAt: input.createdAt,
    index: input.index,
    iv,
    ct,
  };
  return { ...wire, sig: await signPayload(input.signPrivateKey, canonicalChunk(wire)) };
}

export async function verifyMessageWire(
  wire: MessageWire,
  publicKey: PublicKeyBundle,
): Promise<boolean> {
  if (wire.sig.length > 256 || wire.iv.length > 64) return false;
  if (Date.now() - wire.createdAt > MESSAGE_TTL_MS * 2) return false;
  if (wire.createdAt - Date.now() > 60_000) return false;
  return verifyPayload(publicKey.sig, canonicalMessage(wire), wire.sig);
}

export async function verifyChunkWire(
  wire: ChunkWire,
  publicKey: PublicKeyBundle,
): Promise<boolean> {
  if (Date.now() - wire.createdAt > MESSAGE_TTL_MS * 2) return false;
  if (wire.createdAt - Date.now() > 60_000) return false;
  return verifyPayload(publicKey.sig, canonicalChunk(wire), wire.sig);
}

export async function decryptMessageWire(
  wire: MessageWire,
  key: string,
): Promise<z.infer<typeof textPlainSchema> | FilePlain> {
  const aad = messageAad(wire.conversationId, wire.id, wire.senderId, wire.createdAt);
  if (wire.kind === 'text') {
    const value = await decryptJson<unknown>(key, wire.iv, wire.ct, aad);
    return textPlainSchema.parse(value);
  }
  const value = await decryptJson<unknown>(key, wire.iv, wire.ct, aad);
  return filePlainSchema.parse(value);
}

export async function decryptChunkWire(
  wire: ChunkWire,
  key: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const aad = chunkAad(
    wire.conversationId,
    wire.messageId,
    wire.senderId,
    wire.index,
    wire.createdAt,
  );
  return decryptBytes(key, wire.iv, wire.ct, aad);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function clampExpiry(createdAt: number): number {
  const now = Date.now();
  // Never grant more than the full TTL from the moment a message is received,
  // even when the sender's clock is ahead, and expire stale messages at once.
  const sentAt = Math.min(Math.max(createdAt, now - MESSAGE_TTL_MS), now);
  return sentAt + MESSAGE_TTL_MS;
}
