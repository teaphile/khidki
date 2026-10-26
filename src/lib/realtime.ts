import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './env';

type OutboundEntry = {
  channel: RealtimeChannel;
  ready: Promise<RealtimeChannel>;
  idleTimer: number | null;
};

const IDLE_TTL_MS = 90_000;
const outbound = new Map<string, OutboundEntry>();
let activeSelfUserId: string | null = null;

export function setRealtimeSelfUserId(userId: string | null): void {
  activeSelfUserId = userId;
}

function waitForJoin(channel: RealtimeChannel, timeoutMs = 8_000): Promise<RealtimeChannel> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The realtime connection timed out.'));
    }, timeoutMs);

    channel.subscribe((status) => {
      if (settled) return;
      if (status === 'SUBSCRIBED') {
        settled = true;
        window.clearTimeout(timer);
        resolve(channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        settled = true;
        window.clearTimeout(timer);
        reject(new Error('Unable to reach the realtime service.'));
      }
    });
  });
}

function scheduleEviction(userId: string, entry: OutboundEntry): void {
  if (entry.idleTimer !== null) window.clearTimeout(entry.idleTimer);
  entry.idleTimer = window.setTimeout(() => {
    const current = outbound.get(userId);
    if (current !== entry) return;
    outbound.delete(userId);
    void requireSupabase().removeChannel(entry.channel);
  }, IDLE_TTL_MS);
}

async function outboundChannel(userId: string): Promise<RealtimeChannel> {
  const existing = outbound.get(userId);
  if (existing) {
    const state = existing.channel.state;
    if (state === 'joined' || state === 'joining') {
      scheduleEviction(userId, existing);
      return existing.ready;
    }
    if (existing.idleTimer !== null) window.clearTimeout(existing.idleTimer);
    outbound.delete(userId);
    await requireSupabase().removeChannel(existing.channel);
  }

  const channel = requireSupabase().channel(`user:${userId}`, {
    config: { private: true, broadcast: { self: false, ack: true } },
  });

  const ready = waitForJoin(channel).catch(async (error) => {
    const current = outbound.get(userId);
    if (current?.channel === channel) {
      if (current.idleTimer !== null) window.clearTimeout(current.idleTimer);
      outbound.delete(userId);
    }
    await requireSupabase().removeChannel(channel);
    throw error;
  });

  const entry: OutboundEntry = { channel, ready, idleTimer: null };
  outbound.set(userId, entry);
  scheduleEviction(userId, entry);
  return ready;
}

export async function sendUserEvent(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // Never open an outbound channel to our own user topic; doing so would
  // collide with our inbound inbox subscription on the same Realtime client.
  if (!userId || userId === activeSelfUserId) return;

  const channel = await outboundChannel(userId);
  const result = await channel.send({ type: 'broadcast', event, payload });
  if (result !== 'ok') throw new Error('The realtime service did not accept the event.');
}

export async function closeOutboundChannels(): Promise<void> {
  const entries = [...outbound.values()];
  outbound.clear();
  for (const entry of entries) {
    if (entry.idleTimer !== null) window.clearTimeout(entry.idleTimer);
  }
  await Promise.allSettled(entries.map((entry) => requireSupabase().removeChannel(entry.channel)));
}
