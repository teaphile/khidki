import type { RealtimeChannel } from '@supabase/supabase-js';
import { requireSupabase } from './env';

const outbound = new Map<string, RealtimeChannel>();

function waitForJoin(channel: RealtimeChannel, timeoutMs = 6_000): Promise<void> {
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
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        settled = true;
        window.clearTimeout(timer);
        reject(new Error('Unable to reach the realtime service.'));
      }
    });
  });
}

async function outboundChannel(userId: string): Promise<RealtimeChannel> {
  const existing = outbound.get(userId);
  if (existing) return existing;

  const channel = requireSupabase().channel(`user:${userId}`, {
    config: { private: true, broadcast: { self: false } },
  });
  outbound.set(userId, channel);

  try {
    await waitForJoin(channel);
    return channel;
  } catch (error) {
    outbound.delete(userId);
    await requireSupabase().removeChannel(channel);
    throw error;
  }
}

export async function sendUserEvent(
  userId: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const channel = await outboundChannel(userId);
  const result = await channel.send({ type: 'broadcast', event, payload });
  if (result !== 'ok') throw new Error('The realtime service did not accept the event.');
}

export async function closeOutboundChannels(): Promise<void> {
  const channels = [...outbound.values()];
  outbound.clear();
  await Promise.allSettled(channels.map((channel) => requireSupabase().removeChannel(channel)));
}
