import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './env';

type OutboundEntry = {
  channel: RealtimeChannel;
  ready: Promise<RealtimeChannel>;
  failed: boolean;
  lastUsed: number;
};

const MAX_OUTBOUND_CHANNELS = 24;
const IDLE_EVICT_MS = 120_000;
const SUBSCRIBE_TIMEOUT_MS = 7_000;

const outbound = new Map<string, OutboundEntry>();
let selfUserId: string | null = null;

export function setRealtimeSelfUserId(userId: string | null): void {
  selfUserId = userId;
}

function pruneOutbound(now: number): void {
  const client = requireSupabase();
  for (const [topic, entry] of outbound) {
    if (entry.failed || now - entry.lastUsed > IDLE_EVICT_MS) {
      outbound.delete(topic);
      void client.removeChannel(entry.channel);
    }
  }
  while (outbound.size >= MAX_OUTBOUND_CHANNELS) {
    let oldestTopic: string | null = null;
    let oldestTime = Infinity;
    for (const [topic, entry] of outbound) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestTopic = topic;
      }
    }
    if (!oldestTopic) break;
    const evicted = outbound.get(oldestTopic);
    outbound.delete(oldestTopic);
    if (evicted) void client.removeChannel(evicted.channel);
  }
}

async function outboundChannel(topic: string): Promise<RealtimeChannel> {
  const now = Date.now();
  const existing = outbound.get(topic);
  if (
    existing &&
    !existing.failed &&
    existing.channel.state !== 'errored' &&
    existing.channel.state !== 'leaving'
  ) {
    existing.lastUsed = now;
    return existing.ready;
  }

  const client = requireSupabase();
  if (existing) {
    outbound.delete(topic);
    void client.removeChannel(existing.channel);
  }

  pruneOutbound(now);

  const channel = client.channel(topic, {
    config: { private: true, broadcast: { self: false, ack: true } },
  });

  const entry: OutboundEntry = {
    channel,
    failed: false,
    lastUsed: now,
    ready: Promise.resolve(channel),
  };

  entry.ready = new Promise<RealtimeChannel>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      entry.failed = true;
      outbound.delete(topic);
      void client.removeChannel(channel);
      reject(new Error('Realtime channel timed out.'));
    }, SUBSCRIBE_TIMEOUT_MS);

    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timer);
        resolve(channel);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        window.clearTimeout(timer);
        entry.failed = true;
        if (outbound.get(topic) === entry) {
          outbound.delete(topic);
        }
        reject(err ?? new Error(`Realtime channel ${status.toLowerCase()}.`));
      }
    });
  });

  outbound.set(topic, entry);
  return entry.ready;
}

export async function sendUserEvent(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!userId || userId === selfUserId) return;
  const topic = `user:${userId}`;
  const channel = await outboundChannel(topic);
  const result = await channel.send({ type: 'broadcast', event, payload });
  if (result !== 'ok') {
    const failedEntry = outbound.get(topic);
    if (failedEntry?.channel === channel) {
      outbound.delete(topic);
      void requireSupabase().removeChannel(channel);
    }
    throw new Error('Realtime signal delivery failed.');
  }
}

export async function closeOutboundChannels(): Promise<void> {
  const client = requireSupabase();
  const entries = Array.from(outbound.values());
  outbound.clear();
  await Promise.all(entries.map((entry) => client.removeChannel(entry.channel)));
}
