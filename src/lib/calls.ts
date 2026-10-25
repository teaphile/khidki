import { z } from 'zod';
import type { PublicKeyBundle } from '../types';
import { verifyPayload } from './crypto';

export type CallKind = 'offer' | 'answer' | 'ice' | 'decline' | 'end';

const uuid = z.string().uuid();
const base64 = (max: number) => z.string().min(1).max(max);

export const callEnvelopeSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['offer', 'answer', 'ice', 'decline', 'end']),
  callId: uuid,
  conversationId: uuid,
  from: uuid,
  to: uuid,
  ts: z.number().int().positive(),
  iv: base64(64),
  ct: base64(500_000),
  sig: base64(256),
});

export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;

const sessionDescriptionSchema = z.object({
  type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
  sdp: z.string().min(1).max(200_000),
});

const iceSchema = z.object({
  candidate: z.string().max(8_000),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(128).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
});

export const callDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offer'), video: z.boolean(), sdp: sessionDescriptionSchema }),
  z.object({ kind: z.literal('answer'), sdp: sessionDescriptionSchema }),
  z.object({ kind: z.literal('ice'), candidate: iceSchema }),
  z.object({ kind: z.literal('decline'), reason: z.string().max(80).optional() }),
  z.object({ kind: z.literal('end'), reason: z.string().max(80).optional() }),
]);

export type CallData = z.infer<typeof callDataSchema>;

export function canonicalCall(envelope: Omit<CallEnvelope, 'sig'>): string {
  return JSON.stringify([
    'sotto-call-v1',
    envelope.kind,
    envelope.callId,
    envelope.conversationId,
    envelope.from,
    envelope.to,
    envelope.ts,
    envelope.iv,
    envelope.ct,
  ]);
}

export function callAad(envelope: Omit<CallEnvelope, 'sig' | 'iv' | 'ct'>): string {
  return `call:${envelope.kind}:${envelope.callId}:${envelope.conversationId}:${envelope.from}:${envelope.to}`;
}

export async function verifyCallEnvelope(
  envelope: CallEnvelope,
  publicKey: PublicKeyBundle,
): Promise<boolean> {
  if (Math.abs(Date.now() - envelope.ts) > 120_000) return false;
  return verifyPayload(publicKey.sig, canonicalCall(envelope), envelope.sig);
}
